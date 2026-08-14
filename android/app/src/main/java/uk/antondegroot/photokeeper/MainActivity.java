package uk.antondegroot.photokeeper;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * Adds the return leg of the OAuth flow.
 *
 * <p>Sign-in cannot happen in this app's webview. Adobe hands federated accounts off to the identity
 * provider — Google, Behance — and Google deliberately refuses OAuth inside an embedded webview, so
 * the flow has to run in the system browser. That leaves the problem this class exists for: once the
 * browser holds the tokens, nothing brings them back.
 *
 * <p>So the backend, told by {@code ?client=app} that the request came from here, finishes the flow
 * by redirecting to {@code photokeeper://auth#access_token=...} instead of to the website. Android
 * matches that scheme to the intent filter in AndroidManifest.xml, hands the URI here, and this
 * loads the deployed site with the same fragment — the shape the web app already reads its tokens
 * from, so no Angular code has to know any of this happened.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "PhotoKeeperAuth";

    private static final String AUTH_HOST = "auth";

    /**
     * Forces a document load rather than a fragment change. Navigating an already-open page to the
     * same URL with a new fragment fires hashchange and nothing else, and the app reads its tokens
     * during startup — which would not run again.
     */
    private static final String RELOAD_MARKER = "?authReturn=1#";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super so the bridge is built with it available.
        registerPlugin(BatteryOptimizationPlugin.class);
        super.onCreate(savedInstanceState);
        // Cold start: the app was not running when the browser handed the tokens back.
        completeSignIn(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // The usual case: launchMode is singleTask, so the running instance is reused.
        completeSignIn(intent);
    }

    private void completeSignIn(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (uri == null || !AUTH_HOST.equals(uri.getHost())) {
            return;
        }

        String tokens = tokensFrom(uri);
        if (tokens == null) {
            // Logged without the values: knowing which half arrived is the whole diagnosis, and the
            // tokens themselves have no business in logcat.
            Log.w(TAG, "auth return carried neither a query nor a fragment");
            return;
        }

        String serverUrl = getBridge().getConfig().getServerUrl();
        if (serverUrl == null || serverUrl.isEmpty()) {
            Log.w(TAG, "no server URL configured; cannot complete sign-in");
            return;
        }

        String target = withTrailingSlash(serverUrl) + RELOAD_MARKER + tokens;
        WebView webView = getBridge().getWebView();
        webView.post(() -> webView.loadUrl(target));
    }

    /**
     * The token bundle, taken from the query if there is one and the fragment otherwise.
     *
     * <p>Both are read because a fragment does not reliably survive the trip: Chrome drops it when
     * launching an external app from a redirect, so the backend sends the app's tokens as a query
     * instead. The fragment branch stays for the direct {@code adb} case and in case a browser other
     * than Chrome keeps it.
     *
     * <p>Encoded rather than decoded, deliberately. {@link Uri#getFragment()} percent-decodes, and
     * the result is then pasted straight into another URL — which re-reads it as encoded, so any
     * token containing a {@code +} or {@code %} would come out corrupted.
     */
    private static String tokensFrom(Uri uri) {
        String query = uri.getEncodedQuery();
        if (query != null && !query.isEmpty()) {
            return query;
        }
        String fragment = uri.getEncodedFragment();
        return fragment == null || fragment.isEmpty() ? null : fragment;
    }

    private static String withTrailingSlash(String url) {
        return url.endsWith("/") ? url : url + "/";
    }
}