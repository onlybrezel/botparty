/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AnalyticsService {
    /**
     * Get current product analytics consent
     * @returns any
     * @throws ApiError
     */
    public static analyticsControllerConsent(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/analytics/consent',
        });
    }
    /**
     * Set or withdraw product analytics consent
     * @returns any
     * @throws ApiError
     */
    public static analyticsControllerUpdateConsent(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/analytics/consent',
        });
    }
    /**
     * Record a consented first-party product event
     * @returns any
     * @throws ApiError
     */
    public static analyticsControllerIngest(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/analytics/events',
        });
    }
    /**
     * Get reproducible product funnel metrics
     * @returns any
     * @throws ApiError
     */
    public static analyticsControllerDashboard({
        days,
    }: {
        days: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/analytics/admin/dashboard',
            query: {
                'days': days,
            },
        });
    }
}
