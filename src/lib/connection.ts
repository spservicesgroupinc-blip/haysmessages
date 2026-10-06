// Public deployment addresses supplied for this workspace. Replaced deployments
// must not win over the current address through a stale hosting environment.
export const defaultBackendUrl = 'https://script.google.com/macros/s/AKfycbzELGedeAMQlprPvnwy5JkXSicGt7XBRE7AC0dujZ52QP7Zh67CpKly5Nco-ysMGPqCKA/exec';
export const deploymentUrl = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/;
export const retiredDeploymentIds = [
  'AKfycbwkB2KIrVF3i3ZNM7TmFCUF1QkKWkJRj8aljoo-Stwz_ihD5eSfzUaec0t_pe4zCFrT5w',
  'AKfycbxaMg1Kdafihh5nrV_iw3_ryTSUkWjQuxiD1fWZhu1wEfE7bduePILSDnuKRP4TGq2k0A',
  'AKfycbzcbutQRzBUyaY9tzR46tl3xGKFiG1hOOjl_u60oHg8EbkWwFQP9quxrFYoaKYiP1m41g',
];
const retiredUrls = new Set(retiredDeploymentIds.map(id => `https://script.google.com/macros/s/${id}/exec`));
export function resolveBackendUrl(environmentUrl?: string) {
  const candidate = environmentUrl?.trim() || '';
  return deploymentUrl.test(candidate) && !retiredUrls.has(candidate) ? candidate : defaultBackendUrl;
}
