/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MarkPaidPayoutDto } from '../models/MarkPaidPayoutDto';
import type { RejectPayoutDto } from '../models/RejectPayoutDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PayoutsService {
    /**
     * Submit a payout request
     * @returns any
     * @throws ApiError
     */
    public static payoutsControllerCreate(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/payouts',
        });
    }
    /**
     * List my payout requests
     * @returns any
     * @throws ApiError
     */
    public static payoutsControllerList(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/payouts',
        });
    }
    /**
     * List pending payout requests (staff)
     * @returns any
     * @throws ApiError
     */
    public static payoutsControllerListReview(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/payouts/review',
        });
    }
    /**
     * Approve a payout request (staff)
     * @returns any
     * @throws ApiError
     */
    public static payoutsControllerApprove({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/payouts/{id}/approve',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Reject a payout request (staff)
     * @returns any
     * @throws ApiError
     */
    public static payoutsControllerReject({
        id,
        requestBody,
    }: {
        id: string,
        requestBody: RejectPayoutDto,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/payouts/{id}/reject',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Mark approved payout as paid and debit wallet (staff)
     * @returns any
     * @throws ApiError
     */
    public static payoutsControllerMarkPaid({
        id,
        requestBody,
    }: {
        id: string,
        requestBody: MarkPaidPayoutDto,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/payouts/{id}/mark-paid',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Reveal an approved payout destination to the independent payer
     * @returns any
     * @throws ApiError
     */
    public static payoutsControllerRevealDestination({
        id,
    }: {
        id: string,
    }): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/payouts/{id}/destination',
            path: {
                'id': id,
            },
        });
    }
}
