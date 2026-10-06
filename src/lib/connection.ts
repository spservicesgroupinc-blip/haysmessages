// Public deployment addresses supplied for this workspace. Replaced deployments
// must not win over the current address through a stale hosting environment.
export const defaultBackendUrl = 'https://script.google.com/macros/s/AKfycbxK5yd7Xsh_o5pfyLqKBq3MpBKjp-8ia3v9M7QNp8UFtlUiZYEkvvqVzDdLuZVhCZZLEg/exec';
export const deploymentUrl = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/;
export const retiredDeploymentIds = [
  // Previous version 8.1 endpoint.
  'AKfycbxOOS-5XQOPpc3skdOIZTKodi9G0EAyx9OAKpFKoL5bCXzh-fz0tFV2E07dhfJQgRFtiQ',
  'AKfycbwkB2KIrVF3i3ZNM7TmFCUF1QkKWkJRj8aljoo-Stwz_ihD5eSfzUaec0t_pe4zCFrT5w',
  'AKfycbxaMg1Kdafihh5nrV_iw3_ryTSUkWjQuxiD1fWZhu1wEfE7bduePILSDnuKRP4TGq2k0A',
  'AKfycbzcbutQRzBUyaY9tzR46tl3xGKFiG1hOOjl_u60oHg8EbkWwFQP9quxrFYoaKYiP1m41g',
  // Versions 7 and 8 defaults; saved sessions and stale hosting settings migrate to the current deployment.
  'AKfycbzELGedeAMQlprPvnwy5JkXSicGt7XBRE7AC0dujZ52QP7Zh67CpKly5Nco-ysMGPqCKA',
  'AKfycby6iwIDQQ9GvqdH_RC4HejRZCu-nU2WUiDyxjhMFFwNrCsuDiD4WLgcWqFJqdMkftdNtA',
];
const retiredUrls = new Set(retiredDeploymentIds.map(id => `https://script.google.com/macros/s/${id}/exec`));
export function resolveBackendUrl(environmentUrl?: string) {
  const candidate = environmentUrl?.trim() || '';
  return deploymentUrl.test(candidate) && !retiredUrls.has(candidate) ? candidate : defaultBackendUrl;
}
