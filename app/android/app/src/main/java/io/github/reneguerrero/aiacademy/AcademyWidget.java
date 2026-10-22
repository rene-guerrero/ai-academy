package io.github.reneguerrero.aiacademy;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Resources;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.ArrayMap;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.Map;

public abstract class AcademyWidget extends AppWidgetProvider {

    static final String BASE_URL = "https://rene-guerrero.github.io/ai-academy/";
    static final String EXTRA_URL = "io.github.reneguerrero.aiacademy.extra.WIDGET_URL";
    static final String ACTION_OPEN_URL = "io.github.reneguerrero.aiacademy.action.OPEN_URL";
    private static final String PREFS = "aia_widget";
    private static final int MEDIUM_MIN_WIDTH = 200;
    private static final int MEDIUM_MIN_HEIGHT = 100;

    protected abstract boolean prefersMedium();

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            manager.updateAppWidget(id, build(context, manager, id, prefersMedium()));
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int appWidgetId, Bundle newOptions) {
        manager.updateAppWidget(appWidgetId, build(context, manager, appWidgetId, prefersMedium()));
    }

    static boolean isAllowedUrl(String url) {
        if (url == null || url.isEmpty()) return false;
        Uri uri = Uri.parse(url);
        String path = uri.getPath();
        return "https".equals(uri.getScheme())
            && "rene-guerrero.github.io".equals(uri.getHost())
            && uri.getPort() == -1
            && uri.getUserInfo() == null
            && path != null
            && path.startsWith("/ai-academy/")
            && !path.contains("..");
    }

    static void save(Context context, int streak, String activeDay, String nextTitle, String nextUrl, int reviewsDue, long updatedAt) {
        SharedPreferences.Editor editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        editor.putBoolean("has", true);
        editor.putInt("streak", streak);
        editor.putString("activeDay", activeDay == null ? "" : activeDay);
        editor.putString("nextTitle", nextTitle == null ? "" : nextTitle);
        editor.putString("nextUrl", isAllowedUrl(nextUrl) ? nextUrl : "");
        editor.putInt("reviewsDue", reviewsDue);
        editor.putLong("updatedAt", updatedAt);
        editor.apply();
    }

    static int updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int count = 0;
        int[] small = manager.getAppWidgetIds(new ComponentName(context, AcademyWidgetSmall.class));
        for (int id : small) {
            manager.updateAppWidget(id, build(context, manager, id, false));
            count++;
        }
        int[] medium = manager.getAppWidgetIds(new ComponentName(context, AcademyWidgetMedium.class));
        for (int id : medium) {
            manager.updateAppWidget(id, build(context, manager, id, true));
            count++;
        }
        return count;
    }

    private static RemoteViews build(Context context, AppWidgetManager manager, int appWidgetId, boolean mediumByDefault) {
        Snapshot data = Snapshot.load(context);
        RemoteViews small = renderSmall(context, data);
        RemoteViews medium = renderMedium(context, data);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Map<SizeF, RemoteViews> sized = new ArrayMap<>();
            sized.put(new SizeF(40f, 40f), small);
            sized.put(new SizeF(MEDIUM_MIN_WIDTH, MEDIUM_MIN_HEIGHT), medium);
            return new RemoteViews(sized);
        }
        Bundle options = manager.getAppWidgetOptions(appWidgetId);
        int width = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int height = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        if (width == 0 || height == 0) return mediumByDefault ? medium : small;
        return width >= MEDIUM_MIN_WIDTH && height >= MEDIUM_MIN_HEIGHT ? medium : small;
    }

    private static RemoteViews renderSmall(Context context, Snapshot data) {
        Resources res = context.getResources();
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.appwidget_small);
        views.setOnClickPendingIntent(android.R.id.background, openApp(context));
        if (!data.has) {
            views.setTextViewText(R.id.appwidget_streak, res.getString(R.string.app_name));
            views.setTextViewText(R.id.appwidget_next, res.getString(R.string.appwidget_empty));
            return views;
        }
        int streak = data.currentStreak();
        views.setTextViewText(R.id.appwidget_streak, res.getQuantityString(R.plurals.appwidget_streak_line, streak, streak));
        views.setTextViewText(R.id.appwidget_next, data.nextLine(res));
        views.setOnClickPendingIntent(R.id.appwidget_next, openLesson(context, data));
        return views;
    }

    private static RemoteViews renderMedium(Context context, Snapshot data) {
        Resources res = context.getResources();
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.appwidget_medium);
        views.setOnClickPendingIntent(android.R.id.background, openApp(context));
        PendingIntent lesson = openLesson(context, data);
        views.setOnClickPendingIntent(R.id.appwidget_continue, lesson);
        views.setOnClickPendingIntent(R.id.appwidget_next_box, lesson);
        int streak = data.has ? data.currentStreak() : 0;
        String streakLabel = res.getQuantityString(R.plurals.appwidget_streak_label, streak);
        views.setTextViewText(R.id.appwidget_streak_value, String.valueOf(streak));
        views.setTextViewText(R.id.appwidget_streak_label, streakLabel);
        views.setContentDescription(R.id.appwidget_streak_box, res.getQuantityString(R.plurals.appwidget_streak_line, streak, streak));
        if (data.has && data.reviewsDue > 0) {
            String reviewsLine = res.getQuantityString(R.plurals.appwidget_reviews_line, data.reviewsDue, data.reviewsDue);
            views.setViewVisibility(R.id.appwidget_reviews_box, View.VISIBLE);
            views.setTextViewText(R.id.appwidget_reviews_value, String.valueOf(data.reviewsDue));
            views.setTextViewText(R.id.appwidget_reviews_label, res.getQuantityString(R.plurals.appwidget_reviews_label, data.reviewsDue));
            views.setContentDescription(R.id.appwidget_reviews_box, reviewsLine);
        } else {
            views.setViewVisibility(R.id.appwidget_reviews_box, View.GONE);
        }
        if (!data.has) {
            views.setTextViewText(R.id.appwidget_next_label, res.getString(R.string.app_name));
            views.setTextViewText(R.id.appwidget_next, res.getString(R.string.appwidget_empty));
            views.setTextViewText(R.id.appwidget_continue, res.getString(R.string.appwidget_open));
        } else {
            views.setTextViewText(R.id.appwidget_next_label, res.getString(data.nextTitle.isEmpty() ? R.string.appwidget_done_label : R.string.appwidget_next_label));
            views.setTextViewText(R.id.appwidget_next, data.nextLine(res));
            views.setTextViewText(R.id.appwidget_continue, res.getString(data.nextTitle.isEmpty() ? R.string.appwidget_review : R.string.appwidget_continue));
        }
        return views;
    }

    private static PendingIntent openApp(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent openLesson(Context context, Snapshot data) {
        if (!data.has || data.nextUrl.isEmpty()) return openApp(context);
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(ACTION_OPEN_URL);
        intent.putExtra(EXTRA_URL, data.nextUrl);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static final class Snapshot {

        boolean has;
        int streak;
        String activeDay;
        String nextTitle;
        String nextUrl;
        int reviewsDue;
        long updatedAt;

        static Snapshot load(Context context) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            Snapshot s = new Snapshot();
            s.has = prefs.getBoolean("has", false);
            s.streak = prefs.getInt("streak", 0);
            s.activeDay = prefs.getString("activeDay", "");
            s.nextTitle = prefs.getString("nextTitle", "");
            s.nextUrl = prefs.getString("nextUrl", "");
            s.reviewsDue = prefs.getInt("reviewsDue", 0);
            s.updatedAt = prefs.getLong("updatedAt", 0L);
            return s;
        }

        int currentStreak() {
            if (streak <= 0) return 0;
            SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            Calendar cal = Calendar.getInstance();
            String today = fmt.format(cal.getTime());
            cal.add(Calendar.DAY_OF_YEAR, -1);
            String yesterday = fmt.format(cal.getTime());
            String day = activeDay != null && !activeDay.isEmpty() ? activeDay : fmt.format(new Date(updatedAt));
            return today.equals(day) || yesterday.equals(day) ? streak : 0;
        }

        String nextLine(Resources res) {
            return nextTitle.isEmpty() ? res.getString(R.string.appwidget_all_done) : nextTitle;
        }
    }
}
