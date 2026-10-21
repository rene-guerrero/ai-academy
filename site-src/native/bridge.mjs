import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();
export const notifications = isNative && Capacitor.isPluginAvailable("LocalNotifications") ? LocalNotifications : null;
