import { z } from 'zod';

const MAX_TRACKING_NUMBER_LENGTH = 40;

export const trackingParamSchema = z.object({
  trackingNumber: z.string().min(1).max(MAX_TRACKING_NUMBER_LENGTH),
});

export type TrackingParam = z.infer<typeof trackingParamSchema>;
