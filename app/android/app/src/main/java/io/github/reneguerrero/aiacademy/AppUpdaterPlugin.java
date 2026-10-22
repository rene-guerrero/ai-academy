package io.github.reneguerrero.aiacademy;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final int MAX_REDIRECTS = 6;
    private static final long MAX_BYTES = 300L * 1024L * 1024L;
    private final AtomicBoolean busy = new AtomicBoolean(false);

    @PluginMethod
    public void info(PluginCall call) {
        try {
            PackageInfo pi = installedInfo(getContext());
            JSObject result = new JSObject();
            result.put("versionCode", versionCodeOf(pi));
            result.put("versionName", pi.versionName == null ? "" : pi.versionName);
            call.resolve(result);
        } catch (PackageManager.NameNotFoundException e) {
            call.reject("Could not read the installed version.", "INFO_FAILED", e);
        }
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", installsAllowed(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Context context = getContext();
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
        } else {
            intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            Activity activity = getActivity();
            if (activity != null) activity.startActivity(intent);
            else context.startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("The install settings screen is not available on this device.", "NO_SETTINGS", e);
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url", "");
        if (!isAllowedUrl(url)) {
            call.reject("The update address is not allowed.", "BAD_URL");
            return;
        }
        if (!installsAllowed(getContext())) {
            call.reject("Installing updates from this app is not allowed yet.", "NOT_ALLOWED");
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("An update is already downloading.", "BUSY");
            return;
        }
        new Thread(() -> {
            try {
                runInstall(call, url);
            } catch (RuntimeException e) {
                call.reject("The update failed unexpectedly.", "UNEXPECTED", e);
            } finally {
                busy.set(false);
            }
        }, "AppUpdaterDownload").start();
    }

    private void runInstall(PluginCall call, String url) {
        Context context = getContext();
        File dir = new File(context.getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) {
            call.reject("Could not prepare storage for the update.", "STORAGE");
            return;
        }
        File[] old = dir.listFiles();
        if (old != null) {
            for (File f : old) {
                if (!f.delete()) f.deleteOnExit();
            }
        }
        File part = new File(dir, "ai-academy.apk.part");
        File apk = new File(dir, "ai-academy.apk");
        try {
            download(url, part);
        } catch (IOException e) {
            if (!part.delete()) part.deleteOnExit();
            String message = e.getMessage();
            call.reject(message == null || message.isEmpty() ? "The download failed." : "The download failed: " + message, "DOWNLOAD_FAILED", e);
            return;
        }
        if (!part.renameTo(apk)) {
            if (!part.delete()) part.deleteOnExit();
            call.reject("Could not save the downloaded update.", "STORAGE");
            return;
        }
        PackageInfo archive = archiveInfo(context, apk);
        if (archive == null) {
            if (!apk.delete()) apk.deleteOnExit();
            call.reject("The downloaded file is not a valid app package.", "INVALID_APK");
            return;
        }
        if (!context.getPackageName().equals(archive.packageName)) {
            if (!apk.delete()) apk.deleteOnExit();
            call.reject("The downloaded file is a different app.", "WRONG_PACKAGE");
            return;
        }
        long installed;
        try {
            installed = versionCodeOf(installedInfo(context));
        } catch (PackageManager.NameNotFoundException e) {
            call.reject("Could not read the installed version.", "INFO_FAILED", e);
            return;
        }
        long incoming = versionCodeOf(archive);
        if (incoming <= installed) {
            if (!apk.delete()) apk.deleteOnExit();
            call.reject("The downloaded version is not newer than the installed one.", "NOT_NEWER");
            return;
        }
        Uri uri;
        try {
            uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        } catch (IllegalArgumentException e) {
            call.reject("Could not share the update with the installer.", "PROVIDER", e);
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, APK_MIME);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = getActivity();
        Runnable launch = () -> {
            try {
                if (activity != null) activity.startActivity(intent);
                else context.startActivity(intent);
                JSObject result = new JSObject();
                result.put("versionCode", incoming);
                result.put("versionName", archive.versionName == null ? "" : archive.versionName);
                call.resolve(result);
            } catch (ActivityNotFoundException | SecurityException e) {
                call.reject("Could not open the system installer.", "NO_INSTALLER", e);
            }
        };
        if (activity != null) activity.runOnUiThread(launch);
        else launch.run();
    }

    private void download(String start, File target) throws IOException {
        String current = start;
        HttpURLConnection conn = null;
        try {
            for (int hop = 0; ; hop++) {
                if (hop > MAX_REDIRECTS) throw new IOException("too many redirects");
                if (!isAllowedUrl(current)) throw new IOException("redirected to an address that is not allowed");
                conn = (HttpURLConnection) new URL(current).openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(30000);
                conn.setRequestProperty("Accept", "application/octet-stream");
                conn.setRequestProperty("User-Agent", "AI-Academy-Android");
                int code = conn.getResponseCode();
                if (code == HttpURLConnection.HTTP_MOVED_PERM || code == HttpURLConnection.HTTP_MOVED_TEMP || code == HttpURLConnection.HTTP_SEE_OTHER || code == 307 || code == 308) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = null;
                    if (location == null || location.isEmpty()) throw new IOException("redirect without a location");
                    current = new URL(new URL(current), location).toString();
                    continue;
                }
                if (code != HttpURLConnection.HTTP_OK) throw new IOException("server answered " + code);
                break;
            }
            long total = conn.getContentLengthLong();
            if (total > MAX_BYTES) throw new IOException("file too large");
            long received = 0;
            long lastEmit = 0;
            int lastPercent = -1;
            emitProgress(0, total);
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    out.write(buffer, 0, n);
                    received += n;
                    if (received > MAX_BYTES) throw new IOException("file too large");
                    long now = System.currentTimeMillis();
                    int percent = total > 0 ? (int) (received * 100 / total) : -1;
                    if (now - lastEmit >= 150 || (percent != lastPercent && percent >= 0 && now - lastEmit >= 50)) {
                        emitProgress(received, total);
                        lastEmit = now;
                        lastPercent = percent;
                    }
                }
                out.flush();
            }
            if (total > 0 && received != total) throw new IOException("the download was interrupted");
            emitProgress(received, total > 0 ? total : received);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void emitProgress(long received, long total) {
        JSObject data = new JSObject();
        data.put("received", received);
        data.put("total", total);
        notifyListeners("progress", data);
    }

    static boolean isAllowedUrl(String value) {
        if (value == null || value.isEmpty()) return false;
        try {
            URL parsed = new URL(value);
            if (!"https".equalsIgnoreCase(parsed.getProtocol())) return false;
            String host = parsed.getHost();
            if (host == null) return false;
            host = host.toLowerCase(Locale.ROOT);
            return host.equals("github.com") || host.equals("githubusercontent.com") || host.endsWith(".githubusercontent.com");
        } catch (IOException e) {
            return false;
        }
    }

    private static boolean installsAllowed(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return context.getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo installedInfo(Context context) throws PackageManager.NameNotFoundException {
        PackageManager pm = context.getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.getPackageInfo(context.getPackageName(), PackageManager.PackageInfoFlags.of(0));
        }
        return pm.getPackageInfo(context.getPackageName(), 0);
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo archiveInfo(Context context, File apk) {
        PackageManager pm = context.getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.PackageInfoFlags.of(0));
        }
        return pm.getPackageArchiveInfo(apk.getAbsolutePath(), 0);
    }

    @SuppressWarnings("deprecation")
    private static long versionCodeOf(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return info.getLongVersionCode();
        }
        return info.versionCode;
    }
}
