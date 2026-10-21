package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;

import java.io.File;

/**
 * Writes a WebView's PrintDocumentAdapter output to a PDF file without showing the print dialog.
 * Lives in the android.print package because the layout/write callback constructors are package-private
 * (same technique used by widely used open-source HTML-to-PDF libraries).
 */
public class HgiPdfWriter {
    public interface Callback {
        void onSuccess(File file);
        void onFailure(String message);
    }

    public static void write(final PrintDocumentAdapter adapter, final PrintAttributes attributes, final File out, final Callback cb) {
        adapter.onStart();
        adapter.onLayout(null, attributes, new CancellationSignal(), new PrintDocumentAdapter.LayoutResultCallback() {
            @Override
            public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                final ParcelFileDescriptor pfd;
                try {
                    pfd = ParcelFileDescriptor.open(out, ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_TRUNCATE);
                } catch (Exception e) {
                    cb.onFailure(e.getMessage());
                    return;
                }
                adapter.onWrite(new PageRange[]{PageRange.ALL_PAGES}, pfd, new CancellationSignal(), new PrintDocumentAdapter.WriteResultCallback() {
                    @Override
                    public void onWriteFinished(PageRange[] pages) {
                        try { pfd.close(); } catch (Exception ignored) { }
                        adapter.onFinish();
                        if (out.length() > 0) cb.onSuccess(out); else cb.onFailure("empty PDF");
                    }

                    @Override
                    public void onWriteFailed(CharSequence error) {
                        try { pfd.close(); } catch (Exception ignored) { }
                        adapter.onFinish();
                        cb.onFailure(String.valueOf(error));
                    }

                    @Override
                    public void onWriteCancelled() {
                        try { pfd.close(); } catch (Exception ignored) { }
                        adapter.onFinish();
                        cb.onFailure("cancelled");
                    }
                });
            }

            @Override
            public void onLayoutFailed(CharSequence error) { cb.onFailure(String.valueOf(error)); }

            @Override
            public void onLayoutCancelled() { cb.onFailure("cancelled"); }
        }, null);
    }
}
