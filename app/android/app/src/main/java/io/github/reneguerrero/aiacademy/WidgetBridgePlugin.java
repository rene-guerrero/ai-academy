package io.github.reneguerrero.aiacademy;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        JSObject data = call.getData();
        int streak = Math.max(0, data.optInt("streak", 0));
        int reviewsDue = Math.max(0, data.optInt("reviewsDue", 0));
        long updatedAt = data.optLong("updatedAt", System.currentTimeMillis());
        String nextTitle = call.getString("nextTitle", "");
        String nextUrl = call.getString("nextUrl", "");
        String activeDay = call.getString("activeDay", "");
        AcademyWidget.save(getContext(), streak, activeDay, nextTitle, nextUrl, reviewsDue, updatedAt);
        int count = AcademyWidget.updateAll(getContext());
        JSObject result = new JSObject();
        result.put("widgets", count);
        call.resolve(result);
    }
}
