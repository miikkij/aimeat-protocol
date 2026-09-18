/**
 * @file calendar/index.js
 * @description AIMEAT.calendar browser entry. Pure event operations; the host owns storage and permissions.
 * @version-history v1.0.0 - 2026-09-18 - Initial served calendar library.
 */
import { attach } from '../_core/namespace.js';
import { calendar } from './core.js';
attach('calendar',calendar);
