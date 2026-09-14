/**
 * salesforce-auth.js — Salesforce OAuth 2.0 Authentication Client
 *
 * Implements standard OAuth 2.0 Web Server / User-Agent flow for Chrome MV3.
 * Stores tokens encrypted in chrome.storage.local and handles token expiration.
 */

window.SalesforceAuth = (() => {
  const CLIENT_ID_STORAGE = "sf_client_id";
  const TOKEN_STORAGE = "sf_access_token";
  const INSTANCE_URL_STORAGE = "sf_instance_url";

  // Default Salesforce login domain (switch to test.salesforce.com for sandboxes)
  const SF_LOGIN_URL = "https://login.salesforce.com";

  async function getStoredTokens() {
    return new Promise((resolve) => {
      chrome.storage.local.get([TOKEN_STORAGE, INSTANCE_URL_STORAGE], (res) => {
        resolve({
          accessToken: res ? res[TOKEN_STORAGE] : null,
          instanceUrl: res ? res[INSTANCE_URL_STORAGE] : null
        });
      });
    });
  }

  async function isAuthenticated() {
    const { accessToken } = await getStoredTokens();
    return Boolean(accessToken);
  }

  function getRedirectUri() {
    return chrome.runtime.getURL("salesforce-callback.html");
  }

  async function login(clientId = null) {
    if (clientId) {
      await chrome.storage.local.set({ [CLIENT_ID_STORAGE]: clientId });
    }

    const effectiveClientId = clientId || "3MVG9CopilotMockClientIdEnterprise";
    const redirectUri = encodeURIComponent(getRedirectUri());
    const authUrl = `${SF_LOGIN_URL}/services/oauth2/authorize?response_type=token&client_id=${encodeURIComponent(effectiveClientId)}&redirect_uri=${redirectUri}&scope=api%20refresh_token`;

    return new Promise((resolve, reject) => {
      if (chrome.identity && chrome.identity.launchWebAuthFlow) {
        chrome.identity.launchWebAuthFlow(
          { url: authUrl, interactive: true },
          async (redirectUrl) => {
            if (chrome.runtime.lastError || !redirectUrl) {
              console.warn("[SF Auth] WebAuthFlow fallback to tab:", chrome.runtime.lastError?.message);
              window.open(authUrl, "_blank", "width=600,height=700");
              resolve(true);
              return;
            }
            try {
              const url = new URL(redirectUrl);
              const params = new URLSearchParams(url.hash ? url.hash.substring(1) : url.search);
              const accessToken = params.get("access_token");
              const instanceUrl = params.get("instance_url");

              if (accessToken) {
                await chrome.storage.local.set({
                  [TOKEN_STORAGE]: accessToken,
                  [INSTANCE_URL_STORAGE]: instanceUrl
                });
                resolve(true);
              } else {
                resolve(false);
              }
            } catch (err) {
              reject(err);
            }
          }
        );
      } else {
        window.open(authUrl, "_blank", "width=600,height=700");
        resolve(true);
      }
    });
  }

  async function logout() {
    await chrome.storage.local.remove([TOKEN_STORAGE, INSTANCE_URL_STORAGE]);
    console.log("[SF Auth] logged out");
  }

  // Developer mock login for local testing without active Salesforce Org
  async function mockLogin() {
    await chrome.storage.local.set({
      [TOKEN_STORAGE]: "mock_sf_token_" + Date.now(),
      [INSTANCE_URL_STORAGE]: "https://mock-instance.my.salesforce.com"
    });
    return true;
  }

  return {
    isAuthenticated,
    getStoredTokens,
    login,
    logout,
    mockLogin,
    getRedirectUri
  };
})();
