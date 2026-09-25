# Google Search Console and Analytics setup

AgenticSEO reads your Search Console and Google Analytics data with read-only access that you grant. There is no AgenticSEO server, so Google needs an OAuth client of your own to know who is asking. You create it once, in about ten minutes, and it is free.

## 1. Create a Google Cloud project

In the [Google Cloud console](https://console.cloud.google.com/):

1. Create a project, for example "agenticseo".
2. Under **APIs & Services → Library**, enable these three APIs:
   - Google Search Console API
   - Google Analytics Data API
   - Google Analytics Admin API

   You can skip the Analytics APIs if you only use Search Console.

## 2. Configure the consent screen

Under **APIs & Services → OAuth consent screen**:

1. Choose **External** as the user type.
2. Add the scopes `webmasters.readonly` and `analytics.readonly`.
3. Add your own Google account as a test user.
4. **Publish the app** so its status is "In production".

In Testing mode, Google expires your access every seven days and you would have to reconnect. A published app you use yourself does not need Google's review: Google shows an "unverified app" warning during sign-in, which you can accept.

## 3. Create the OAuth client

Under **APIs & Services → Credentials**, create an **OAuth client ID** of type **Desktop app**. Copy its client ID and client secret.

## 4. Connect

```sh
GOOGLE_CLIENT_ID="…apps.googleusercontent.com" GOOGLE_CLIENT_SECRET="…" agenticseo google connect
```

AgenticSEO prints a Google sign-in address and opens it in your browser. Approve access, and the terminal confirms the connected account. `--for search-console` or `--for analytics` asks for only one of them.

Then pick the property for each website, from the website's folder:

```sh
agenticseo gsc sites
agenticseo gsc use sc-domain:example.com
agenticseo ga4 properties
agenticseo ga4 use 123456789
agenticseo gsc report
```

The `seo-project-setup` skill walks your agent through the same steps.

## Where access is stored

The grant is saved per Google account in `~/.config/agenticseo/google-accounts.json`, readable only by you. If `XDG_CONFIG_HOME` is set, it is saved under that folder instead. The client ID and secret are stored with it, because Google needs them to renew access; Google does not treat a Desktop client's secret as confidential. Nothing is written to your project except which property it uses.

`agenticseo google accounts` lists connected accounts. `agenticseo google disconnect EMAIL` revokes access at Google and deletes it locally.

## Troubleshooting

| Message | What to do |
| --- | --- |
| Google does not know the OAuth client | Copy the client ID and secret again from the Desktop client. A new client can take a few minutes to start working. |
| The API has not been used in project … or it is disabled | Enable the API named in the message (step 1), wait a minute and try again. |
| Access was revoked or has expired | Run `agenticseo google connect` again. If this happens every week, publish the app (step 2). |
| has not granted Search Console (or Analytics) access | Connect again and tick both permissions on Google's consent page, or use `--for`. |
| Could not reach Google | Check your connection. Behind a proxy, set `HTTPS_PROXY`. |
| Google Analytics reporting is temporarily unavailable | Google had a temporary problem. Try again in a minute. |
