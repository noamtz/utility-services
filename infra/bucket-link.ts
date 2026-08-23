let bucketLinkConfigured = false;

export function configureLeastPrivilegeBucketLink(): void {
  if (bucketLinkConfigured) return;
  sst.Linkable.wrap(sst.aws.Bucket, (bucket) => ({
    properties: { name: bucket.name },
    include: [],
  }));
  bucketLinkConfigured = true;
}
