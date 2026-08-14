package uk.antondegroot.photokeeper;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets the app ask to be exempted from battery optimisation, so its daily reminders actually fire.
 *
 * <p>Doze defers alarms from apps it considers idle, which is precisely what PhotoKeeper is between
 * sessions: a reminder is scheduled for 09:00 and the phone has no reason to think the app matters
 * until then. The exemption is the supported way to say otherwise, and {@code isIgnoring} is what
 * lets the Settings screen show whether it is in force — so a missing reminder can be diagnosed
 * rather than guessed at.
 *
 * <p>It is not a guarantee. This only covers stock Android's optimisation; manufacturer layers —
 * OnePlus and OPPO's ColorOS especially — keep their own auto-launch and background restrictions
 * with no public API, and force-stopping an app from recents cancels its alarms regardless.
 */
@CapacitorPlugin(name = "BatteryOptimization")
public class BatteryOptimizationPlugin extends Plugin {

    @PluginMethod
    public void isIgnoring(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ignoring", isIgnoringOptimizations());
        call.resolve(result);
    }

    /**
     * Shows the system's "allow this app to run in the background?" dialog.
     *
     * <p>Resolves as soon as the dialog is raised rather than waiting for an answer: the result
     * arrives as a settings change, not as an activity result, so the caller re-reads
     * {@link #isIgnoring} when the app comes back to the foreground.
     */
    @PluginMethod
    public void request(PluginCall call) {
        JSObject result = new JSObject();
        if (isIgnoringOptimizations()) {
            result.put("ignoring", true);
            call.resolve(result);
            return;
        }

        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        getActivity().startActivity(intent);

        result.put("ignoring", false); // still false; the dialog has only just been shown
        call.resolve(result);
    }

    private boolean isIgnoringOptimizations() {
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return power != null && power.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }
}
