## ADDED Requirements

### Requirement: Provider proxy config syncs to Claude settings.json env

When a Provider with `appType: Claude` is switched (activated), the system SHALL write `proxy_config.httpProxy` to `env.HTTP_PROXY` and `proxy_config.httpsProxy` to `env.HTTPS_PROXY` in `~/.claude/settings.json`.

#### Scenario: Provider with proxy enabled is switched
- **WHEN** a Claude Provider with `proxyConfig = { enabled: true, httpProxy: "http://127.0.0.1:7890", httpsProxy: "http://127.0.0.1:7890" }` is activated
- **THEN** `~/.claude/settings.json` env SHALL contain `"HTTP_PROXY": "http://127.0.0.1:7890"` and `"HTTPS_PROXY": "http://127.0.0.1:7890"`

#### Scenario: Provider with proxy disabled is switched
- **WHEN** a Claude Provider with `proxyConfig = { enabled: false }` is activated
- **THEN** `~/.claude/settings.json` env SHALL NOT contain `HTTP_PROXY` or `HTTPS_PROXY` keys (they are removed if previously present)

#### Scenario: Provider with no proxy config is switched
- **WHEN** a Claude Provider with `proxyConfig = null` is activated
- **THEN** `~/.claude/settings.json` env SHALL NOT contain `HTTP_PROXY` or `HTTPS_PROXY` keys (they are removed if previously present)

#### Scenario: Only httpProxy is set
- **WHEN** a Claude Provider has `proxyConfig = { enabled: true, httpProxy: "http://127.0.0.1:7890", httpsProxy: null }`
- **THEN** `~/.claude/settings.json` env SHALL contain `"HTTP_PROXY": "http://127.0.0.1:7890"` and SHALL NOT contain `HTTPS_PROXY`

### Requirement: Frontend provides URL-based proxy input

The frontend ProviderProxyConfig component SHALL provide two text input fields for entering complete proxy URLs (HTTP and HTTPS), with a toggle to enable/disable.

#### Scenario: User enables proxy and enters URLs
- **WHEN** user toggles proxy on and enters `http://127.0.0.1:7890` in the HTTP proxy field
- **THEN** `proxyConfig` is saved as `{ enabled: true, httpProxy: "http://127.0.0.1:7890" }`

#### Scenario: User disables proxy
- **WHEN** user toggles proxy off
- **THEN** `proxyConfig` is saved as `{ enabled: false }` and the URL fields are cleared

#### Scenario: User clears proxy URL while enabled
- **WHEN** user clears both URL fields while proxy toggle is on
- **THEN** `proxyConfig.enabled` remains true but httpProxy/httpsProxy are empty strings or null

### Requirement: Backward compatibility with old proxy config format

The system SHALL deserialize old-format `proxyConfig` data (`proxyType`, `proxyHost`, `proxyPort`, `proxyUsername`, `proxyPassword`) without errors and present a constructed URL in the UI.

#### Scenario: Old format data is loaded
- **WHEN** a Provider has `proxyConfig = { enabled: true, proxyType: "http", proxyHost: "127.0.0.1", proxyPort: 7890 }`
- **THEN** the frontend SHALL display `http://127.0.0.1:7890` in the HTTP proxy input field

#### Scenario: Old format with credentials is loaded
- **WHEN** a Provider has `proxyConfig = { enabled: true, proxyType: "http", proxyHost: "proxy.example.com", proxyPort: 8080, proxyUsername: "user", proxyPassword: "pass" }`
- **THEN** the frontend SHALL display `http://user:pass@proxy.example.com:8080` in the HTTP proxy input field
