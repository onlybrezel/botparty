/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class BillingService {
    /**
     * List available credit packages
     * @returns any
     * @throws ApiError
     */
    public static billingControllerListPackages(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/billing/packages',
        });
    }
    /**
     * List available subscription plans
     * @returns any
     * @throws ApiError
     */
    public static billingControllerListSubscriptionPlans(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/billing/subscription-plans',
        });
    }
    /**
     * Create a credit purchase checkout session
     * @returns any
     * @throws ApiError
     */
    public static billingControllerCheckout(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/billing/checkout',
        });
    }
    /**
     * List billing webhook events for staff review
     * @returns any
     * @throws ApiError
     */
    public static billingControllerListWebhookEvents(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/billing/admin/webhook-events',
        });
    }
    /**
     * Replay a stored billing webhook event
     * @returns any
     * @throws ApiError
     */
    public static billingControllerReplayWebhookEvent({
        eventId,
    }: {
        eventId: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/billing/admin/webhook-events/{eventId}/replay',
            path: {
                'eventId': eventId,
            },
        });
    }
    /**
     * Stripe webhook receiver
     * @returns any
     * @throws ApiError
     */
    public static billingControllerStripeWebhook(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/billing/webhooks/stripe',
        });
    }
    /**
     * PayPal webhook receiver
     * @returns any
     * @throws ApiError
     */
    public static billingControllerPaypalWebhook(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/billing/webhooks/paypal',
        });
    }
}
