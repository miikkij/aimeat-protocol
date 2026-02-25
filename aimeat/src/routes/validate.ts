import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import { success, error } from '../middleware/envelope.js';

// Basic schema expectations per path+method
const SCHEMAS: Record<string, Record<string, { required?: string[]; types?: Record<string, string> }>> = {
    '/v1/memory': {
        POST: { required: ['key', 'value'] },
    },
    '/v1/agents': {
        POST: { required: ['name', 'owner'] },
    },
    '/v1/owners': {
        POST: { required: ['name', 'public_key'] },
    },
    '/v1/actions': {
        POST: { required: ['id', 'display_name', 'description', 'input_schema', 'output_schema', 'pricing'] },
    },
    '/v1/work/request': {
        POST: { required: ['action_id', 'provider_gaii', 'input'] },
    },
    '/v1/boards': {
        POST: { required: ['name', 'type'] },
    },
    '/v1/auth/token': {
        POST: { required: ['timestamp', 'signature'] },
    },
};

export function validateRouter(config: MeatConfig): Router {
    const router = Router();

    // POST /v1/validate — validate a request against schemas
    router.post('/v1/validate', (req, res) => {
        const { method, path, body } = req.body ?? {};

        if (!method || !path) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'method and path are required'));
            return;
        }

        const schemaForPath = SCHEMAS[path];
        if (!schemaForPath) {
            res.json(success(config.nodeId, {
                valid: true,
                note: `No schema validation rules defined for ${path}. Request assumed valid.`,
            }));
            return;
        }

        const schema = schemaForPath[method.toUpperCase()];
        if (!schema) {
            res.json(success(config.nodeId, {
                valid: true,
                note: `No schema for ${method} ${path}. Request assumed valid.`,
            }));
            return;
        }

        const errors: { field: string; message: string; expected: string }[] = [];

        if (schema.required) {
            for (const field of schema.required) {
                if (body === undefined || body === null || !(field in body)) {
                    errors.push({ field, message: `Missing required field: ${field}`, expected: 'present' });
                }
            }
        }

        if (schema.types && body) {
            for (const [field, expectedType] of Object.entries(schema.types)) {
                if (field in body && typeof body[field] !== expectedType) {
                    errors.push({ field, message: `Wrong type for ${field}`, expected: expectedType });
                }
            }
        }

        res.json(success(config.nodeId, {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined,
            method,
            path,
        }));
    });

    return router;
}
