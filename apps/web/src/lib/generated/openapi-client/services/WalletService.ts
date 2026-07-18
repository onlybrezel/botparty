/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class WalletService {
    /**
     * Get current wallet summary (balance + recent transactions)
     * @returns any
     * @throws ApiError
     */
    public static walletControllerGetMe(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/wallet/me',
        });
    }
    /**
     * List wallet transactions (cursor-paginated)
     * @returns any
     * @throws ApiError
     */
    public static walletControllerListTransactions(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/wallet/transactions',
        });
    }
    /**
     * Export the complete filtered wallet ledger
     * @returns any
     * @throws ApiError
     */
    public static walletControllerExportTransactions(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/wallet/transactions/export',
        });
    }
    /**
     * Donate credits to a robot owner
     * @returns any
     * @throws ApiError
     */
    public static walletControllerDonate(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/wallet/donations',
        });
    }
}
