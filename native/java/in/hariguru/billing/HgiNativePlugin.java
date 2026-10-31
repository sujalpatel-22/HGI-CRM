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
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Environment;
import android.print.HgiPdfWriter;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;

import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

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
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import com.getcapacitor.JSArray;

/**
 * Native helpers for the HGI Billing web app:
 *  - print():      Android print dialog for the current page (uses the app's @media print CSS)
 *  - sharePdf():   renders the current page to an A4 PDF and opens the share sheet (WhatsApp, Gmail, Drive…)
 *  - savePdf():    renders an A4 PDF into Downloads/HGI Billing
 *  - saveFile() / shareFile(): CSV / JSON backups
 *  - openUrl():    wa.me, mailto:, upi: links in the right app
 *  - writeState() / readState(): durable copy of the app data in private app storage
 *  - pdfToCache() / clearCacheDir() / zipAndDeliver(): bulk export — each document rendered to a PDF, all zipped into one file
 *  - shareToWhatsApp(): renders the current document to PDF and hands PDF + message to WhatsApp (share sheet if WhatsApp is missing)
 *  - getConfig():  public cloud-sync settings of this build (sync service URL, OAuth web client ID) — no secrets
 *  - googleSignIn() / googleSignOut(): "Sign in with Google" (Android Credential Manager) → Google ID token,
 *                  which the app exchanges for its own session at the HGI sync service
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

    private void renderPdf(PluginCall call, String fileName, PdfDone done) { renderPdf(call, "pdf", fileName, done); }

    private void renderPdf(PluginCall call, String subdir, String fileName, PdfDone done) {
        getActivity().runOnUiThread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), subdir);
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

    /* ------------------------------------------------------------------ cloud sync config + Sign in with Google */
    private String res(String name) {
        int id = getContext().getResources().getIdentifier(name, "string", getContext().getPackageName());
        return id == 0 ? "" : getContext().getString(id);
    }

    @PluginMethod
    public void getConfig(PluginCall call) {
        JSObject r = new JSObject();
        r.put("auth", res("hgi_auth").isEmpty() ? "off" : res("hgi_auth"));
        r.put("syncUrl", res("hgi_sync_url"));
        r.put("webClientId", res("hgi_web_client_id"));
        // debuggable builds only (CI test APK): lets automated tests switch sign-in modes. Release builds are never debuggable.
        r.put("debug", (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        call.resolve(r);
    }

    @PluginMethod
    public void googleSignIn(PluginCall call) {
        String serverClientId = call.getString("serverClientId", "");
        if (serverClientId == null || serverClientId.isEmpty()) { call.reject("Google client ID missing in this build", "not_configured"); return; }
        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(serverClientId).build();
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
        CredentialManager cm = CredentialManager.create(getContext());
        cm.getCredentialAsync(getActivity(), request, new CancellationSignal(), ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    Credential c = response.getCredential();
                    if (c instanceof CustomCredential && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
                        try {
                            GoogleIdTokenCredential g = GoogleIdTokenCredential.createFrom(c.getData());
                            JSObject r = new JSObject();
                            r.put("idToken", g.getIdToken());
                            r.put("email", g.getId());
                            r.put("name", g.getDisplayName());
                            call.resolve(r);
                        } catch (Exception e) { call.reject("Google sign-in returned an unreadable answer", "google_failed", e); }
                    } else call.reject("Unexpected sign-in answer", "google_failed");
                }
                @Override
                public void onError(GetCredentialException e) {
                    if (e instanceof GetCredentialCancellationException) call.reject("Sign-in cancelled", "cancelled");
                    else if (e instanceof NoCredentialException) call.reject("No Google account on this device", "no_account");
                    else call.reject(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage(), "google_failed", e);
                }
            });
    }

    @PluginMethod
    public void googleSignOut(PluginCall call) {
        CredentialManager cm = CredentialManager.create(getContext());
        cm.clearCredentialStateAsync(new ClearCredentialStateRequest(), new CancellationSignal(), ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override public void onResult(Void v) { call.resolve(); }
                @Override public void onError(ClearCredentialException e) { call.resolve(); }   // nothing stored is fine
            });
    }

    /* ------------------------------------------------------------------ bulk export: PDFs → one ZIP */
    private File cacheSub(String name) throws Exception {
        String clean = name == null ? "" : name.replaceAll("[^a-zA-Z0-9_-]", "");
        if (clean.isEmpty()) throw new Exception("bad folder name");
        File dir = new File(getContext().getCacheDir(), clean);
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create cache dir");
        return dir;
    }

    @PluginMethod
    public void clearCacheDir(PluginCall call) {
        try {
            File dir = cacheSub(call.getString("dir", "bulk"));
            File[] fs = dir.listFiles();
            if (fs != null) for (File f : fs) //noinspection ResultOfMethodCallIgnored
                f.delete();
            call.resolve();
        } catch (Exception e) { call.reject("Could not clear: " + e.getMessage(), e); }
    }

    @PluginMethod
    public void pdfToCache(PluginCall call) {
        final String fileName = call.getString("fileName", "Invoice.pdf");
        final String dir = call.getString("dir", "bulk");
        try { cacheSub(dir); } catch (Exception e) { call.reject(e.getMessage()); return; }
        renderPdf(call, dir.replaceAll("[^a-zA-Z0-9_-]", ""), fileName, f -> {
            JSObject r = new JSObject(); r.put("name", f.getName()); r.put("bytes", f.length()); call.resolve(r);
        });
    }

    @PluginMethod
    public void zipAndDeliver(PluginCall call) {
        try {
            File dir = cacheSub(call.getString("dir", "bulk"));
            String zipName = safeName(call.getString("zipName", "HGI_Invoices.zip"), "HGI_Invoices.zip");
            if (!zipName.toLowerCase().endsWith(".zip")) zipName += ".zip";
            String action = call.getString("action", "save");
            JSArray names = call.getArray("names", new JSArray());
            JSArray extra = call.getArray("extra", new JSArray());
            File outDir = cacheSub("export");
            File zip = new File(outDir, zipName);
            int count = 0;
            Set<String> used = new HashSet<>();
            try (ZipOutputStream zos = new ZipOutputStream(new FileOutputStream(zip))) {
                List<String> order = new ArrayList<>();
                for (int i = 0; i < names.length(); i++) order.add(names.getString(i));
                for (String n : order) {
                    File f = new File(dir, safeName(n, "x.pdf"));
                    if (!f.exists() || !f.getCanonicalPath().startsWith(dir.getCanonicalPath())) continue;
                    if (!used.add(f.getName())) continue;
                    zos.putNextEntry(new ZipEntry(f.getName()));
                    try (InputStream in = new FileInputStream(f)) { byte[] buf = new byte[16384]; int k; while ((k = in.read(buf)) > 0) zos.write(buf, 0, k); }
                    zos.closeEntry();
                    count++;
                }
                for (int i = 0; i < extra.length(); i++) {
                    org.json.JSONObject x = extra.getJSONObject(i);
                    String en = safeName(x.optString("name", "info.txt"), "info.txt");
                    if (!used.add(en)) continue;
                    zos.putNextEntry(new ZipEntry(en));
                    zos.write(x.optString("text", "").getBytes(StandardCharsets.UTF_8));
                    zos.closeEntry();
                }
            }
            if (count == 0) { call.reject("No PDFs were created"); return; }
            JSObject r = new JSObject(); r.put("count", count); r.put("bytes", zip.length()); r.put("name", zipName);
            if ("share".equals(action)) {
                shareUri(providerUri(zip), "application/zip", "", zipName);
                r.put("location", "share sheet");
            } else {
                try { r.put("location", copyToDownloads(zip, zipName, "application/zip")); }
                catch (Exception e) { shareUri(providerUri(zip), "application/zip", "", zipName); r.put("location", "share sheet"); }
            }
            call.resolve(r);
        } catch (Exception e) { call.reject("ZIP failed: " + e.getMessage(), e); }
    }

    /* ------------------------------------------------------------------ WhatsApp: PDF + message */
    private boolean installed(String pkg) {
        try { getContext().getPackageManager().getPackageInfo(pkg, 0); return true; }
        catch (PackageManager.NameNotFoundException e) { return false; }
    }

    @PluginMethod
    public void shareToWhatsApp(PluginCall call) {
        final String fileName = call.getString("fileName", "Invoice.pdf");
        final String text = call.getString("text", "");
        final String phone = call.getString("phone", "").replaceAll("[^0-9]", "");
        final String title = call.getString("title", "Invoice");
        renderPdf(call, fileName, f -> {
            try {
                Uri uri = providerUri(f);
                boolean wa = installed("com.whatsapp"), wab = installed("com.whatsapp.w4b");
                JSObject r = new JSObject();
                if (!wa && !wab) {
                    shareUri(uri, "application/pdf", text, title);
                    r.put("target", "share-sheet"); call.resolve(r); return;
                }
                Intent main = waIntent(wa ? "com.whatsapp" : "com.whatsapp.w4b", uri, text, phone);
                Intent launch = main;
                if (wa && wab) {   // both WhatsApp and WhatsApp Business: let the user pick between the two only
                    launch = Intent.createChooser(main, "Share on WhatsApp");
                    launch.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { waIntent("com.whatsapp.w4b", uri, text, phone) });
                    launch.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                }
                getActivity().startActivity(launch);
                r.put("target", wa && wab ? "whatsapp-choice" : wa ? "whatsapp" : "whatsapp-business");
                call.resolve(r);
            } catch (Exception e) { call.reject("WhatsApp share failed: " + e.getMessage(), e); }
        });
    }

    private Intent waIntent(String pkg, Uri uri, String text, String phone) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("application/pdf");
        send.setPackage(pkg);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
        // WhatsApp opens this chat directly when the number is on WhatsApp (otherwise it shows its contact picker)
        if (phone != null && phone.length() >= 10) send.putExtra("jid", phone + "@s.whatsapp.net");
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return send;
    }
}
