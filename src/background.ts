import browser from "webextension-polyfill";

// The URL of our deployed Vercel backend
const BACKEND_URL = "https://notion-web-clipper-obbi.vercel.app";

browser.runtime.onInstalled.addListener(() => {
  console.log("Notion Web Clipper Obbi installed.");
});

// Listen for messages from the popup to start login
// @ts-expect-error - webextension-polyfill supports returning a Promise
browser.runtime.onMessage.addListener(async (request: any, _sender, _sendResponse) => {
  if (request.action === "login") {
    try {
      const redirectUri = browser.identity.getRedirectURL();
      const clientId = import.meta.env.VITE_NOTION_CLIENT_ID;
      
      if (!clientId) {
        throw new Error("Missing VITE_NOTION_CLIENT_ID in environment.");
      }

      const authUrl = `https://api.notion.com/v1/oauth/authorize?client_id=${clientId}&response_type=code&owner=user&redirect_uri=${encodeURIComponent(redirectUri)}`;

      // 1. Launch the interactive Notion OAuth screen
      const responseUrl = await browser.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: true,
      });

      // 2. Extract the temporary code from the URL Notion redirected us to
      const url = new URL(responseUrl);
      const code = url.searchParams.get("code");

      if (!code) {
        throw new Error("No authorization code returned from Notion");
      }

      // 3. Send the code to our Vercel backend to exchange it for an Access Token
      const tokenResponse = await fetch(`${BACKEND_URL}/api/auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code, redirectUri }),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
      }

      // 4. Save the token securely in local storage
      await browser.storage.local.set({
        notion_access_token: tokenData.access_token,
        notion_workspace_name: tokenData.workspace_name,
        notion_workspace_icon: tokenData.workspace_icon,
      });

      return { success: true };
    } catch (error: any) {
      console.error("Login failed:", error);
      return { success: false, error: error.message };
    }
  }
});
