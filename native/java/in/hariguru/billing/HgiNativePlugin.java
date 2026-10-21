package in.hariguru.billing;

import android.content.ContentResolver;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.LayerDrawable;
import android.view.Gravity;
import android.view.View;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.HgiPdfWriter;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Native helpers for the HGI Billing web app:
 *  - print():      Android print dialog for the current page (uses the app's @media print CSS)
 *  - sharePdf():   renders the current page to an A4 PDF and opens the share sheet (WhatsApp, Gmail, Drive…)
 *  - savePdf():    renders an A4 PDF into Downloads/HGI Billing
 *  - saveFile() / shareFile(): CSV / JSON backups
 *  - openUrl():    wa.me, mailto:, upi: links in the right app
 *  - writeState() / readState(): durable copy of the app data in private app storage
 */
@CapacitorPlugin(name = "HgiNative")
public class HgiNativePlugin extends Plugin {

    private static final String DOWNLOAD_SUBDIR = "HGI Billing";

    private PrintAttributes a4() {
        return new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .setResolution(new PrintAttributes.Resolution("hgi", "hgi", 600, 600))
                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .build();
    }

    private static String safeName(String name, String fallback) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|]+", "_").trim();
        return n.isEmpty() ? fallback : n;
    }

    /**
     * Colours shown behind the status bar (top half) and the navigation bar (bottom half) when the
     * WebView is laid out between the system bars (Capacitor does that on WebView &lt; 140). Keeps the
     * area above the navy header navy and the area below the tab bar the tab bar's colour.
     */
    @PluginMethod
    public void setBarColors(PluginCall call) {
        final int top, bottom;
        try {
            top = Color.parseColor(call.getString("top", "#062a52"));
            bottom = Color.parseColor(call.getString("bottom", "#ffffff"));
        } catch (IllegalArgumentException e) {
            call.reject("bad colour");
            return;
        }
        getActivity().runOnUiThread(() -> {
            View decor = getActivity().getWindow().getDecorView();
            int half = Math.max(getContext().getResources().getDisplayMetrics().heightPixels,
                                getContext().getResources().getDisplayMetrics().widthPixels) / 2 + 1;
            LayerDrawable ld = new LayerDrawable(new Drawable[] { new ColorDrawable(bottom), new ColorDrawable(top) });
            ld.setLayerGravity(1, Gravity.TOP | Gravity.FILL_HORIZONTAL);
            ld.setLayerHeight(1, half);
            decor.setBackground(ld);
            call.resolve();
        });
    }

    @PluginMethod
    public void print(PluginCall call) {
        final String name = safeName(call.getString("name", "Invoice"), "Invoice");
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                WebView wv = getBridge().getWebView();
                PrintDocumentAdapter adapter = wv.createPrintDocumentAdapter(name);
                pm.print(name, adapter, a4());
                call.resolve();
            } catch (Exception e) {
                call.reject("Print failed: " + e.getMessage(), e);
            }
        });
    }

    private interface PdfDone { void ok(File f); }

    private void renderPdf(PluginCall call, String fileName, PdfDone done) {
        getActivity().runOnUiThread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "pdf");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create cache dir");
                File out = new File(dir, safeName(fileName, "Invoice.pdf"));
                WebView wv = getBridge().getWebView();
                PrintDocumentAdapter adapter = wv.createPrintDocumentAdapter(out.getName());
                HgiPdfWriter.write(adapter, a4(), out, new HgiPdfWriter.Callback() {
                    @Override public void onSuccess(File f) { done.ok(f); }
                    @Override public void onFailure(String message) { call.reject("PDF failed: " + message); }
                });
            } catch (Exception e) {
                call.reject("PDF failed: " + e.getMessage(), e);
            }
        });
    }

    private Uri providerUri(File f) {
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
    }

    private void shareUri(Uri uri, String mime, String text, String title) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(mime);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
        if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(send, title == null ? "Share" : title);
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().startActivity(chooser);
    }

    @PluginMethod
    public void sharePdf(PluginCall call) {
        final String fileName = call.getString("fileName", "Invoice.pdf");
        final String text = call.getString("text", "");
        final String title = call.getString("title", "Invoice");
        renderPdf(call, fileName, f -> {
            try {
                shareUri(providerUri(f), "application/pdf", text, title);
                JSObject r = new JSObject(); r.put("path", f.getAbsolutePath()); call.resolve(r);
            } catch (Exception e) { call.reject("Share failed: " + e.getMessage(), e); }
        });
    }

    @PluginMethod
    public void savePdf(PluginCall call) {
        final String fileName = call.getString("fileName", "Invoice.pdf");
        renderPdf(call, fileName, f -> {
            try {
                String where = copyToDownloads(f, safeName(fileName, "Invoice.pdf"), "application/pdf");
                JSObject r = new JSObject(); r.put("location", where); call.resolve(r);
            } catch (Exception e) {
                // older Android: offer the share sheet instead (no storage permission needed)
                try { shareUri(providerUri(f), "application/pdf", "", fileName); JSObject r = new JSObject(); r.put("location", "share sheet"); call.resolve(r); }
                catch (Exception e2) { call.reject("Save failed: " + e.getMessage(), e); }
            }
        });
    }

    /** Copies a file into the public Downloads folder (Android 10+, no permission needed). */
    private String copyToDownloads(File src, String name, String mime) throws Exception {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw new Exception("Downloads needs Android 10+");
        ContentResolver cr = getContext().getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + DOWNLOAD_SUBDIR);
        Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
        if (uri == null) throw new Exception("MediaStore insert failed");
        try (InputStream in = new FileInputStream(src); OutputStream out = cr.openOutputStream(uri)) {
            if (out == null) throw new Exception("cannot open output");
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        return "Downloads/" + DOWNLOAD_SUBDIR + "/" + name;
    }

    private File writeTemp(String fileName, String base64) throws Exception {
        File dir = new File(getContext().getCacheDir(), "export");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create cache dir");
        File f = new File(dir, safeName(fileName, "export.bin"));
        try (FileOutputStream o = new FileOutputStream(f)) { o.write(Base64.decode(base64, Base64.DEFAULT)); }
        return f;
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        String fileName = call.getString("fileName", "export.bin");
        String b64 = call.getString("base64", "");
        String mime = call.getString("mime", "application/octet-stream");
        try {
            File f = writeTemp(fileName, b64);
            String where = copyToDownloads(f, safeName(fileName, "export.bin"), mime);
            JSObject r = new JSObject(); r.put("location", where); call.resolve(r);
        } catch (Exception e) { call.reject("Save failed: " + e.getMessage(), e); }
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        String fileName = call.getString("fileName", "export.bin");
        String b64 = call.getString("base64", "");
        String mime = call.getString("mime", "application/octet-stream");
        String text = call.getString("text", "");
        try {
            File f = writeTemp(fileName, b64);
            getActivity().runOnUiThread(() -> {
                try { shareUri(providerUri(f), mime, text, fileName); call.resolve(); }
                catch (Exception e) { call.reject("Share failed: " + e.getMessage(), e); }
            });
        } catch (Exception e) { call.reject("Share failed: " + e.getMessage(), e); }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.matches("^(https?|mailto|tel|upi|whatsapp):.*")) { call.reject("URL scheme not allowed"); return; }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) { call.reject("No app can open this link", e); }
    }

    private File stateFile(String key) {
        return new File(getContext().getFilesDir(), "hgi-" + key.replaceAll("[^a-zA-Z0-9_-]", "") + ".json");
    }

    @PluginMethod
    public void writeState(PluginCall call) {
        String key = call.getString("key", "state");
        String data = call.getString("data", "");
        File target = stateFile(key);
        File tmp = new File(target.getAbsolutePath() + ".tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) {
            o.write(data.getBytes(StandardCharsets.UTF_8));
            o.getFD().sync();
        } catch (Exception e) { call.reject("Write failed: " + e.getMessage(), e); return; }
        if (!tmp.renameTo(target)) { call.reject("Rename failed"); return; }
        call.resolve();
    }

    @PluginMethod
    public void readState(PluginCall call) {
        File f = stateFile(call.getString("key", "state"));
        JSObject r = new JSObject();
        if (!f.exists()) { r.put("data", null); call.resolve(r); return; }
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int off = 0, n;
            while (off < buf.length && (n = in.read(buf, off, buf.length - off)) > 0) off += n;
            r.put("data", new String(buf, 0, off, StandardCharsets.UTF_8));
            call.resolve(r);
        } catch (Exception e) { call.reject("Read failed: " + e.getMessage(), e); }
    }
}
