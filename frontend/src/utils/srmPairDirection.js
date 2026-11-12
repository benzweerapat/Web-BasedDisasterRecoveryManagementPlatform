export function matchesPairDirection(object, pair) {
  if (!pair) return false;
  const protectedSite = String(object?.protectedSiteName || object?.protected_site_name || '').trim();
  const recoverySite = String(object?.recoverySiteName || object?.recovery_site_name || '').trim();
  const localSite = String(pair.local_site_name || pair.localSiteName || '').trim();
  const remoteSite = String(pair.remote_site_name || pair.remoteSiteName || '').trim();
  return Boolean(protectedSite && recoverySite && localSite && remoteSite) &&
    protectedSite === localSite && recoverySite === remoteSite;
}
