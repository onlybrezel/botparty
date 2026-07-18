/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class HealthService {
    /**
     * Health check
     * @returns any
     * @throws ApiError
     */
    public static healthControllerCheck(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/health',
        });
    }
    /**
     * Readiness check for traffic routing
     * @returns any
     * @throws ApiError
     */
    public static healthControllerReady(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/health/ready',
        });
    }
    /**
     * Liveness check for container startup probes
     * @returns any
     * @throws ApiError
     */
    public static healthControllerLive(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/health/live',
        });
    }
    /**
     * Public platform stats for landing pages and dashboards
     * @returns any
     * @throws ApiError
     */
    public static healthControllerStats(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/health/stats',
        });
    }
    /**
     * Prometheus metrics endpoint
     * @returns any
     * @throws ApiError
     */
    public static healthControllerMetrics(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/health/metrics',
        });
    }
    /**
     * Receive browser Content Security Policy violation reports
     * @returns void
     * @throws ApiError
     */
    public static healthControllerCspReport(): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/health/csp-report',
        });
    }
}
