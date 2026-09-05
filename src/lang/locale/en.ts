// English locale — the base locale. Other locales are Partial<Lang> and fall
// back to English for any missing key.
export type Lang = {
  // ---- settings: groups ----
  groupConnection: string
  groupDevice: string
  groupSync: string
  groupDiagnostics: string
  groupDanger: string

  // ---- settings: status card ----
  statusTitle: string
  statusUnauthWaiting: string
  statusUnconfigured: string
  statusConnectedVault: string
  statusObservingVault: string
  statusConnectingVault: string
  statusAuthenticatingVault: string
  statusDisconnectedVault: string
  statusNoServer: string
  syncProgress: string
  observingTitle: string
  observingBody: string

  // ---- settings: connection form ----
  howToAuthName: string
  howToAuthBody: string
  serverUrlName: string
  serverUrlDesc: string
  tokenName: string
  tokenDesc: string
  vaultNameName: string
  vaultNameDesc: string
  vaultNamePlaceholder: string
  connectName: string
  connectDesc: string
  connectButton: string
  noticeNeedServerAndToken: string
  noticeNeedVaultName: string

  // ---- settings: device ----
  deviceNameName: string
  deviceNameDesc: string
  deviceNamePlaceholder: string
  saveButton: string
  noticeDeviceNameUnchanged: string
  savingButton: string
  noticeDeviceNameUpdated: string
  deviceIdName: string
  deviceIdDesc: string
  deviceIdNotGenerated: string

  // ---- settings: sync ----
  autoSyncName: string
  autoSyncDesc: string
  syncNowName: string
  syncNowDesc: string
  syncNowButton: string
  refreshAuthName: string
  refreshAuthDesc: string
  refreshAuthButton: string

  // ---- settings: diagnostics ----
  versionInfoName: string
  versionInfoHead: string
  versionPlugin: string
  versionMinObsidian: string
  versionServerLive: string
  versionServerCached: string
  versionServer: string
  versionServerUnknown: string
  logSectionName: string
  logSectionHead: string
  logEmpty: string
  logActionsName: string
  logActionsDesc: string
  logCopyButton: string
  noticeLogCopied: string
  logClearButton: string

  // ---- settings: danger zone ----
  dangerName: string
  dangerDesc: string
  dangerButton: string
  disconnectModalTitle: string
  disconnectModalItem1: string
  disconnectModalItem2: string
  disconnectModalItem3: string
  cancelButton: string
  disconnectConfirmButton: string

  // ---- commands / ribbon ----
  ribbonTooltip: string
  cmdSyncNow: string
  cmdOpenSettings: string
  menuSyncNow: string
  menuSettings: string
  menuAutoSyncOn: string
  menuAutoSyncOff: string
  noticeAutoSyncOn: string
  noticeAutoSyncOff: string

  // ---- status bar ----
  statusBarAuthorized: string
  statusBarObservingVault: string
  statusBarObserving: string
  statusSyncingProgress: string

  // ---- ribbon status line ----
  menuConnectedOk: string
  menuConnectedVaultOk: string
  menuObservingVault: string
  menuDisconnectedVault: string
  menuDisconnected: string

  // ---- sync flow notices / logs ----
  noticeNotConnected: string
  noticeObservingNoSync: string
  noticeReconciling: string
  noticeUpToDate: string
  noticeSyncDone: string
  logAuthed: string
  logAuthedVault: string
  logAuthedObserving: string
  logServerVersion: string
  logSyncResumed: string
  logSyncSilenced: string
  noticeSyncResumed: string
  noticeSyncSilenced: string
  logAuthFailed: string
  logAuthFailedNoReason: string
  noticeInvalidToken: string
  noticeAuthFailed: string
  logPluginLoaded: string
  logPluginUnloaded: string
  logReconcileStart: string
  logManifestSent: string
  logReconcileResult: string
  logReconcileClean: string
  logSkipReconcileRename: string
  logSyncFinished: string
  logConnState: string
  logUploadFailed: string
  logDownloadFailed: string
  logServerError: string
  logDeviceNameUpdated: string
  logOauthInvalid: string
  logOauthDeepLink: string
  noticeOauthInvalid: string
  noticeOauthConnecting: string
  noticeOauthConnectingVault: string

  // ---- connect / confirm modal ----
  logConnectFromSettings: string
  noticeConnecting: string
  logConfirmSync: string
  logConfirmSyncMismatch: string
  logCancelSync: string
  noticeCancelled: string
  confirmModalTitle: string
  confirmModalServer: string
  confirmModalVault: string
  confirmModalYourName: string
  confirmModalHint: string
  confirmModalMismatchTitle: string
  confirmModalMismatchBody: string
  confirmSyncButton: string
  noticeRefreshAuthMissing: string
  logRefreshAuth: string
  noticeRefreshingAuth: string
  logDisconnect: string
  noticeDisconnected: string
}

export default {
  // ---- settings: groups ----
  groupConnection: 'Connection',
  groupDevice: 'This device',
  groupSync: 'Sync',
  groupDiagnostics: 'Diagnostics',
  groupDanger: 'Danger zone',

  // ---- settings: status card ----
  statusTitle: 'Connection status',
  statusUnauthWaiting: 'Not authorized · waiting for approval in the web console',
  statusUnconfigured: 'Not configured · enter your server info below',
  statusConnectedVault: 'Connected to remote OWiki · {vault}',
  statusObservingVault: 'Connected, not the sync device · {vault}',
  statusConnectingVault: 'Connecting · {vault}',
  statusAuthenticatingVault: 'Connected, authenticating · {vault}',
  statusDisconnectedVault: 'Disconnected · reconnecting (vault {vault})',
  statusNoServer: 'No server configured',
  syncProgress: 'Syncing {done}/{total}',
  observingTitle: 'This device is not the selected sync device',
  observingBody:
    'This vault has "single-device sync" enabled: only the selected device syncs files. This device stays connected (and can be switched to the sync device anytime), but its changes are not uploaded. To sync from this device, change the selected device in the OWiki web console vault settings.',

  // ---- settings: connection form ----
  howToAuthName: 'How to get authorization info',
  howToAuthBody:
    'Open the vault settings page in the OWiki web console, copy the WebSocket URL and the sync token; or use "One-click authorize" to jump back into Obsidian. Fill them in, click Connect, and confirm the sync details to start syncing.',
  serverUrlName: 'Server address',
  serverUrlDesc: 'The OWiki WebSocket address, e.g. ws://localhost:8787/ws',
  tokenName: 'Token',
  tokenDesc: 'The sync token from the OWiki web console vault settings',
  vaultNameName: 'Remote vault name',
  vaultNameDesc:
    'Required: the name you gave the vault in the web console. Checked on connect — if the server returns a different vault you will be warned, so you never sync into the wrong vault.',
  vaultNamePlaceholder: 'e.g. Personal notes',
  connectName: 'Connect',
  connectDesc: 'A confirmation dialog appears after connecting; sync starts once you confirm',
  connectButton: 'Connect',
  noticeNeedServerAndToken: 'Please fill in the server address and token first',
  noticeNeedVaultName: 'Please fill in the remote vault name',

  // ---- settings: device ----
  deviceNameName: 'Device name',
  deviceNameDesc:
    'Visible on this device only. After changing it, click Save — the plugin reconnects once to push the new name to the server.',
  deviceNamePlaceholder: 'e.g. Mac Studio',
  saveButton: 'Save',
  noticeDeviceNameUnchanged: 'Device name unchanged',
  savingButton: 'Saving…',
  noticeDeviceNameUpdated: 'Device name updated to "{name}"',
  deviceIdName: 'Device ID',
  deviceIdDesc: 'First 8 characters. The full ID is in the log (printed on first load).',
  deviceIdNotGenerated: 'not generated',

  // ---- settings: sync ----
  autoSyncName: 'Auto sync',
  autoSyncDesc: 'When on, edits are pushed automatically (2s debounce)',
  syncNowName: 'Sync now',
  syncNowDesc: 'Full reconciliation: upload the local manifest, then upload/download the diff',
  syncNowButton: 'Sync now',
  refreshAuthName: 'Refresh authorization',
  refreshAuthDesc: 'Reconnect to the server to verify the token is still valid',
  refreshAuthButton: 'Refresh',

  // ---- settings: diagnostics ----
  versionInfoName: 'Version info',
  versionInfoHead: 'Version info',
  versionPlugin: 'Plugin version',
  versionMinObsidian: 'Minimum Obsidian',
  versionServerLive: 'Server (current connection)',
  versionServerCached: 'Server (last authentication)',
  versionServer: 'Server',
  versionServerUnknown: 'Not connected, or server version too old',
  logSectionName: 'Logs',
  logSectionHead: 'Logs',
  logEmpty: '(no logs yet)',
  logActionsName: 'Log actions',
  logActionsDesc: 'Full log lives at <config-dir>/plugins/owiki-sync/log.txt',
  logCopyButton: 'Copy',
  noticeLogCopied: 'Log copied',
  logClearButton: 'Clear',

  // ---- settings: danger zone ----
  dangerName: 'Disconnect and revoke authorization',
  dangerDesc: 'Clears the locally stored server address and token',
  dangerButton: 'Disconnect & revoke',
  disconnectModalTitle: 'Disconnect and revoke authorization?',
  disconnectModalItem1: 'Clears the locally stored server address and sync token',
  disconnectModalItem2:
    'Tells the server to unbind this device (the vault and synced data on the server are unaffected)',
  disconnectModalItem3:
    'To invalidate the token entirely, use "Revoke" in the OWiki web console',
  cancelButton: 'Cancel',
  disconnectConfirmButton: 'Disconnect & revoke',

  // ---- commands / ribbon ----
  ribbonTooltip: 'OWiki Sync',
  cmdSyncNow: 'Sync now',
  cmdOpenSettings: 'Open sync settings',
  menuSyncNow: 'Sync now',
  menuSettings: 'Sync settings...',
  menuAutoSyncOn: 'Disable auto sync',
  menuAutoSyncOff: 'Enable auto sync',
  noticeAutoSyncOn: 'Auto sync enabled',
  noticeAutoSyncOff: 'Auto sync disabled',

  // ---- status bar ----
  statusBarAuthorized: ' · authorized',
  statusBarObservingVault: ' · connected {vault} (not syncing)',
  statusBarObserving: ' · not syncing',
  statusSyncingProgress: 'Syncing {done}/{total}',

  // ---- ribbon status line ----
  menuConnectedOk: 'Connected · sync healthy',
  menuConnectedVaultOk: 'Connected · "{vault}" sync healthy',
  menuObservingVault: 'Connected{vault} not the sync device (single-device sync mode)',
  menuDisconnectedVault: 'Server not connected (authorized for "{vault}")',
  menuDisconnected: 'Server not connected',

  // ---- sync flow notices / logs ----
  noticeNotConnected: 'Not connected to the server',
  noticeObservingNoSync:
    'This device is not the selected sync device (single-device sync mode); changes will not sync',
  noticeReconciling: 'Reconciling ({count} files)',
  noticeUpToDate: 'Everything is up to date',
  noticeSyncDone: 'Sync finished ({count} items)',
  logAuthed: 'Authenticated',
  logAuthedVault: 'Authenticated, remote vault: "{vault}"',
  logAuthedObserving: 'Authenticated (not the sync device, observing)',
  logServerVersion: 'Server version: v{version}',
  logSyncResumed: 'Syncing resumed',
  logSyncSilenced: 'This device has been silenced',
  noticeSyncResumed: 'Syncing resumed for this device, reconciling',
  noticeSyncSilenced: 'This device is not the selected sync device; changes will not sync',
  logAuthFailed: 'Authentication failed: {reason}',
  logAuthFailedNoReason: 'Authentication failed: unknown reason',
  noticeInvalidToken: 'Token or vault name is wrong, please double-check and retry',
  noticeAuthFailed: 'Authentication failed{reason}',
  logPluginLoaded:
    'Plugin loaded: vault={vault} deviceId={deviceId}… deviceName={deviceName} autoSync={autoSync}',
  logPluginUnloaded: 'Plugin unloaded, disconnecting',
  logReconcileStart: 'Starting full reconciliation',
  logManifestSent: 'Manifest sent ({count} files), waiting for diffs',
  logReconcileResult: 'Reconciled: {ups} to upload / {downs} to download / {dels} local orphans removed',
  logReconcileClean: 'Reconciliation finished: already up to date',
  logSkipReconcileRename: 'Skipping auto reconciliation (rename reconnect, content unchanged)',
  logSyncFinished: 'Sync finished ({count} items)',
  logConnState: 'Connection state -> {state}',
  logUploadFailed: 'Upload failed {path}: {error}',
  logDownloadFailed: 'Failed to write remote content {path}: {error}',
  logServerError: 'Server error: {message}',
  logDeviceNameUpdated: 'Local device name updated to "{name}"',
  logOauthInvalid: 'Deep link params invalid: server={server} token={token}',
  logOauthDeepLink: 'One-click authorize deep link received{vault}',
  noticeOauthInvalid: 'Authorization link is invalid',
  noticeOauthConnecting: 'Connecting, please confirm sync in the dialog…',
  noticeOauthConnectingVault: 'Connecting "{vault}", please confirm sync in the dialog…',

  // ---- connect / confirm modal ----
  logConnectFromSettings: 'Connect initiated from settings{vault}',
  noticeConnecting: 'Connecting to the server…',
  logConfirmSync: 'User confirmed syncing to "{vault}"{mismatch}',
  logConfirmSyncMismatch: ' (name mismatch confirmed anyway)',
  logCancelSync: 'User cancelled sync (remote vault: "{vault}")',
  noticeCancelled: 'Cancelled, sync not started',
  confirmModalTitle: 'Confirm sync details',
  confirmModalServer: 'Server',
  confirmModalVault: 'Remote vault',
  confirmModalYourName: 'Name you entered',
  confirmModalHint:
    'After confirming, this vault and the remote "{vault}" will be fully reconciled (two-way).',
  confirmModalMismatchTitle: 'Vault name mismatch',
  confirmModalMismatchBody:
    'You entered "{hint}", but this token actually belongs to "{vault}". Make sure this is the right vault — after confirming, sync will target "{vault}".',
  confirmSyncButton: 'Confirm sync',
  noticeRefreshAuthMissing: 'Please fill in the server address and token first',
  logRefreshAuth: 'Refreshing authorization: forcing a reconnect to re-authenticate',
  noticeRefreshingAuth: 'Refreshing authorization…',
  logDisconnect: 'Disconnected from settings: unbinding on server and clearing local credentials',
  noticeDisconnected: 'Disconnected and local authorization cleared',
}
