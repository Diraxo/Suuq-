import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Default config: no incremental cache bindings, so nothing here touches R2.
export default defineCloudflareConfig();
