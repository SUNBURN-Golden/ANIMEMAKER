package com.animemaker.mobile;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.view.WindowManager;
import android.webkit.MimeTypeMap;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 폰 앱 전용 기능.
 * - 다른 AI 앱(ChatGPT·Gemini·Grok·Claude)으로 프롬프트와 그림을 바로 보내기
 * - 다른 앱에서 '공유' 로 보낸 그림·영상·글을 받아 오기
 * - 완성 영상을 갤러리(동영상/AnimeMaker)에 저장
 * - 영상 만드는 동안 화면 꺼짐 막기
 */
@CapacitorPlugin(name = "AnimeMakerNative")
public class AnimeMakerNativePlugin extends Plugin {

    private JSObject pendingShare = null;

    @Override
    public void load() {
        Intent intent = getActivity().getIntent();
        if (intent != null) handleShareIntent(intent);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleShareIntent(intent);
    }

    /** 다른 앱에서 공유로 들어온 내용을 캐시 폴더에 복사하고 웹 쪽에 알린다 */
    private void handleShareIntent(Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        JSArray items = new JSArray();
        File dir = new File(getContext().getCacheDir(), "shared");
        dir.mkdirs();
        for (Uri u : uris) {
            try {
                String name = displayName(u);
                String mime = getContext().getContentResolver().getType(u);
                if (mime == null) mime = guessMime(name);
                File out = new File(dir, System.currentTimeMillis() + "_" + name.replaceAll("[^\\w.\\-가-힣]", "_"));
                try (InputStream in = getContext().getContentResolver().openInputStream(u);
                     OutputStream os = new FileOutputStream(out)) {
                    copy(in, os);
                }
                JSObject it = new JSObject();
                it.put("path", out.getAbsolutePath());
                it.put("name", name);
                it.put("mime", mime);
                it.put("size", out.length());
                items.put(it);
            } catch (Exception e) {
                // 읽을 수 없는 항목은 건너뛴다
            }
        }
        JSObject data = new JSObject();
        data.put("items", items);
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        data.put("text", text == null ? "" : text.toString());
        // 같은 공유를 두 번 처리하지 않도록 비운다
        getActivity().setIntent(new Intent());
        if (hasListeners("shared")) {
            notifyListeners("shared", data);
        } else {
            pendingShare = data; // 웹이 아직 준비 전 → takePendingShare 로 받아 간다
        }
    }

    /** 앱이 꺼져 있다가 공유로 켜졌을 때, 웹이 준비된 뒤 받아 간다 */
    @PluginMethod
    public void takePendingShare(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("share", pendingShare);
        pendingShare = null;
        call.resolve(ret);
    }

    @PluginMethod
    public void isInstalled(PluginCall call) {
        String pkg = call.getString("pkg", "");
        JSObject ret = new JSObject();
        ret.put("installed", installed(pkg));
        call.resolve(ret);
    }

    /** AI 앱으로 글(프롬프트)과 파일(참고 그림 등)을 보낸다. 앱이 없으면 '공유' 창을 연다. */
    @PluginMethod
    public void shareTo(PluginCall call) {
        String pkg = call.getString("pkg", "");
        String text = call.getString("text", "");
        JSArray files = call.getArray("files", new JSArray());
        try {
            ArrayList<Uri> uris = new ArrayList<>();
            String type = null;
            for (int i = 0; i < files.length(); i++) {
                File f = new File(files.getString(i));
                if (!f.exists()) continue;
                uris.add(FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f));
                String m = guessMime(f.getName());
                type = type == null ? m : (type.equals(m) ? type : "*/*");
            }
            Intent send;
            if (uris.size() > 1) {
                send = new Intent(Intent.ACTION_SEND_MULTIPLE);
                send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            } else {
                send = new Intent(Intent.ACTION_SEND);
                if (uris.size() == 1) send.putExtra(Intent.EXTRA_STREAM, uris.get(0));
            }
            send.setType(type == null ? "text/plain" : type);
            if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
            if (!uris.isEmpty()) {
                ClipData clip = ClipData.newRawUri("", uris.get(0));
                for (int i = 1; i < uris.size(); i++) clip.addItem(new ClipData.Item(uris.get(i)));
                send.setClipData(clip);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            boolean direct = !pkg.isEmpty() && installed(pkg);
            JSObject ret = new JSObject();
            if (direct) {
                send.setPackage(pkg);
                try {
                    getActivity().startActivity(send);
                    ret.put("direct", true);
                    call.resolve(ret);
                    return;
                } catch (ActivityNotFoundException e) {
                    send.setPackage(null);
                }
            }
            getActivity().startActivity(Intent.createChooser(send, "보낼 앱 고르기"));
            ret.put("direct", false);
            call.resolve(ret);
        } catch (JSONException e) {
            call.reject("파일 목록을 읽지 못했어요", e);
        } catch (Exception e) {
            call.reject("다른 앱으로 보내지 못했어요: " + e.getMessage(), e);
        }
    }

    /** 앱 열기 (없으면 웹 주소를 브라우저로) */
    @PluginMethod
    public void openApp(PluginCall call) {
        String pkg = call.getString("pkg", "");
        String url = call.getString("url", "");
        try {
            Intent launch = pkg.isEmpty() ? null : getContext().getPackageManager().getLaunchIntentForPackage(pkg);
            if (launch != null) {
                getActivity().startActivity(launch);
            } else if (!url.isEmpty()) {
                getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } else {
                call.reject("앱이 설치되어 있지 않아요");
                return;
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("앱을 열지 못했어요: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }

    /** 캐시에 있는 영상/그림 파일을 갤러리(동영상/AnimeMaker 또는 사진/AnimeMaker)에 저장 */
    @PluginMethod
    public void saveToGallery(PluginCall call) {
        String path = call.getString("path", "");
        String name = call.getString("name", "AnimeMaker.mp4");
        File src = new File(path);
        if (!src.exists()) {
            call.reject("저장할 파일이 없어요");
            return;
        }
        String mime = guessMime(name);
        boolean video = mime.startsWith("video/");
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // 안드로이드 9 이하는 '공유' 로 저장하도록 웹 쪽에서 안내한다
            JSObject ret = new JSObject();
            ret.put("saved", false);
            ret.put("reason", "old-android");
            call.resolve(ret);
            return;
        }
        ContentResolver cr = getContext().getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/AnimeMaker");
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri collection = video
                ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri item = null;
        try {
            item = cr.insert(collection, v);
            if (item == null) throw new IllegalStateException("insert failed");
            try (InputStream in = new FileInputStream(src); OutputStream os = cr.openOutputStream(item)) {
                copy(in, os);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(item, done, null, null);
            JSObject ret = new JSObject();
            ret.put("saved", true);
            ret.put("uri", item.toString());
            ret.put("folder", (video ? "동영상" : "사진") + "/AnimeMaker");
            call.resolve(ret);
        } catch (Exception e) {
            if (item != null) {
                try { cr.delete(item, null, null); } catch (Exception ignored) { }
            }
            call.reject("갤러리에 저장하지 못했어요: " + e.getMessage(), e);
        }
    }

    private boolean installed(String pkg) {
        if (pkg == null || pkg.isEmpty()) return false;
        try {
            getContext().getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private String displayName(Uri u) {
        String name = null;
        try (Cursor c = getContext().getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) { }
        if (name == null) name = u.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "shared";
        return name;
    }

    private static String guessMime(String name) {
        String ext = MimeTypeMap.getFileExtensionFromUrl(name.replace(" ", "_"));
        String m = ext == null ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase());
        return m == null ? "application/octet-stream" : m;
    }

    private static void copy(InputStream in, OutputStream os) throws java.io.IOException {
        byte[] buf = new byte[1 << 16];
        int n;
        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
    }
}
