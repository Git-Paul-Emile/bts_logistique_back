import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getHealth, getReadiness } from './health.controller.js';

export const healthRouter: Router = Router();

healthRouter.get('/health', getHealth);
healthRouter.get('/ready', asyncHandler(getReadiness));
