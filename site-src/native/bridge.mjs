import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { TextToSpeech } from "@capacitor-community/text-to-speech";

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();
export const notifications = isNative && Capacitor.isPluginAvailable("LocalNotifications") ? LocalNotifications : null;
export const widget = isNative && Capacitor.isPluginAvailable("WidgetBridge") ? registerPlugin("WidgetBridge") : null;
export const tts = isNative && Capacitor.isPluginAvailable("TextToSpeech") ? TextToSpeech : null;
