# BotParty API

Real-time robot teleoperation platform API

Generated from OpenAPI 0.1.3.

Source: docs/openapi.json

## Base URL

No server URL declared in the spec.

## Authentication

| Name | Type | Scheme | Description |
| --- | --- | --- | --- |
| bearer | http | bearer |  |

## Endpoints

### analytics

#### GET /analytics/admin/dashboard

Get reproducible product funnel metrics

Authentication: bearer
Operation ID: AnalyticsController_dashboard

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| query | days | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /analytics/consent

Get current product analytics consent

Authentication: bearer
Operation ID: AnalyticsController_consent

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### PATCH /analytics/consent

Set or withdraw product analytics consent

Authentication: bearer
Operation ID: AnalyticsController_updateConsent

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /analytics/events

Record a consented first-party product event

Authentication: bearer
Operation ID: AnalyticsController_ingest

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

### auth

#### GET /auth/csrf

Issue CSRF token for double-submit protection

Authentication: Public
Operation ID: AuthController_getCsrfToken

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /auth/forgot-password

Request a password reset email

Authentication: Public
Operation ID: AuthController_forgotPassword

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /auth/login

Login with email/password

Authentication: Public
Operation ID: AuthController_login

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /auth/logout

Logout / revoke refresh tokens

Authentication: Public
Operation ID: AuthController_logout

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /auth/logout-all

Revoke all refresh tokens for the current user (sign out everywhere)

Authentication: bearer
Operation ID: AuthController_logoutAll

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /auth/refresh

Refresh access token

Authentication: Public
Operation ID: AuthController_refresh

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /auth/register

Register a new user

Authentication: Public
Operation ID: AuthController_register

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### POST /auth/reset-password

Reset password with token

Authentication: Public
Operation ID: AuthController_resetPassword

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /auth/verify-email

Verify email address with one-time token

Authentication: Public
Operation ID: AuthController_verifyEmail

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| query | token | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /auth/verify-email/resend

Resend an email verification link

Authentication: Public
Operation ID: AuthController_resendVerifyEmail

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

### billing

#### GET /billing/admin/webhook-events

List billing webhook events for staff review

Authentication: bearer
Operation ID: BillingController_listWebhookEvents

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /billing/admin/webhook-events/{eventId}/replay

Replay a stored billing webhook event

Authentication: bearer
Operation ID: BillingController_replayWebhookEvent

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | eventId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### POST /billing/checkout

Create a credit purchase checkout session

Authentication: bearer
Operation ID: BillingController_checkout

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### GET /billing/packages

List available credit packages

Authentication: Public
Operation ID: BillingController_listPackages

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /billing/subscription-plans

List available subscription plans

Authentication: Public
Operation ID: BillingController_listSubscriptionPlans

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /billing/webhooks/paypal

PayPal webhook receiver

Authentication: Public
Operation ID: BillingController_paypalWebhook

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /billing/webhooks/stripe

Stripe webhook receiver

Authentication: Public
Operation ID: BillingController_stripeWebhook

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

### controls

#### PATCH /controls/{buttonId}

Update a control button

Authentication: bearer
Operation ID: ControlsController_update

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | buttonId | Yes | string |  |

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### DELETE /controls/{buttonId}

Delete a control button

Authentication: bearer
Operation ID: ControlsController_remove

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | buttonId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 204 |  |  |

#### GET /controls/robot/{robotId}

Get active control buttons for a robot

Authentication: Public
Operation ID: ControlsController_getPublicButtons

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |
| header | authorization | Yes | string |  |
| header | cookie | Yes | string |  |
| query | roomAccessToken | Yes | string |  |
| query | guestSessionId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /controls/robot/{robotId}

Create a control button

Authentication: bearer
Operation ID: ControlsController_create

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### GET /controls/robot/{robotId}/all

Get all control buttons (owner only)

Authentication: bearer
Operation ID: ControlsController_getAllButtons

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### PUT /controls/robot/{robotId}/reorder

Reorder control buttons

Authentication: bearer
Operation ID: ControlsController_reorder

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 204 |  |  |

### earnings

#### GET /earnings/me

Get earnings summary for the current creator

Authentication: bearer
Operation ID: EarningsController_me

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

### health

#### GET /health

Health check

Authentication: Public
Operation ID: HealthController_check

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /health/csp-report

Receive browser Content Security Policy violation reports

Authentication: Public
Operation ID: HealthController_cspReport

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 204 |  |  |

#### GET /health/live

Liveness check for container startup probes

Authentication: Public
Operation ID: HealthController_live

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /health/metrics

Prometheus metrics endpoint

Authentication: Public
Operation ID: HealthController_metrics

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /health/ready

Readiness check for traffic routing

Authentication: Public
Operation ID: HealthController_ready

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /health/stats

Public platform stats for landing pages and dashboards

Authentication: Public
Operation ID: HealthController_stats

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

### livekit

#### POST /livekit/token/robot/{robotId}

Get LiveKit robot publisher token

Authentication: bearer
Operation ID: LivekitController_getRobotToken

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### POST /livekit/token/viewer-public/{robotId}

Get guest LiveKit viewer token (ACL-aware)

Authentication: Public
Operation ID: LivekitController_getPublicViewerToken

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |
| query | guestSessionId | Yes | string |  |
| query | roomAccessToken | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### POST /livekit/token/viewer/{robotId}

Get LiveKit viewer/controller token

Authentication: bearer
Operation ID: LivekitController_getViewerToken

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |
| query | control | Yes | string |  |
| query | roomAccessToken | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

### moderation

#### GET /moderation/admin/overview

Get moderation overview for admin/mod dashboard

Authentication: bearer
Operation ID: ModerationController_getAdminOverview

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| query | robotId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /moderation/admin/profanity-overview

Get profanity counters and events across all robots for staff

Authentication: bearer
Operation ID: ModerationController_getAdminProfanityOverview

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /moderation/admin/recordings

List available recording files (admin only)

Authentication: bearer
Operation ID: ModerationController_listAdminRecordings

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /moderation/admin/recordings/{fileName}

Stream a recording file (admin only)

Authentication: bearer
Operation ID: ModerationController_streamAdminRecording

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | fileName | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /moderation/admin/recordings/{fileName}/signed

Stream a recording file via short-lived signed URL

Authentication: bearer
Operation ID: ModerationController_streamSignedAdminRecording

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | fileName | Yes | string |  |
| query | expires | Yes | string |  |
| query | signature | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /moderation/admin/robot/{robotId}/actions

Queue a remote robot action from the staff dashboard

Authentication: bearer
Operation ID: ModerationController_enqueueStaffRobotAction

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### GET /moderation/admin/robot/{robotId}/recording

Get LiveKit recording status for a robot room (admin only)

Authentication: bearer
Operation ID: ModerationController_getAdminRobotRecordingStatus

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /moderation/admin/robot/{robotId}/recording/start

Start LiveKit recording for a robot room (admin only)

Authentication: bearer
Operation ID: ModerationController_startAdminRobotRecording

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### POST /moderation/admin/robot/{robotId}/recording/stop

Stop LiveKit recording for a robot room (admin only)

Authentication: bearer
Operation ID: ModerationController_stopAdminRobotRecording

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### GET /moderation/admin/runtime-overview

Get runtime, host, and LiveKit overview for staff dashboard

Authentication: bearer
Operation ID: ModerationController_getAdminRuntimeOverview

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /moderation/robot/{robotId}

Apply a moderation action (timeout / kick / ban / unban)

Authentication: bearer
Operation ID: ModerationController_moderate

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### GET /moderation/robot/{robotId}/log

Get moderation log for a robot (owner / staff)

Authentication: bearer
Operation ID: ModerationController_getLog

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /moderation/robot/{robotId}/profanity

Get profanity counters and recent events for a robot

Authentication: bearer
Operation ID: ModerationController_getProfanityOverview

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

### notifications

#### GET /notifications

List notifications for the current user

Authentication: bearer
Operation ID: NotificationsController_list

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| query | cursor | Yes | string |  |
| query | limit | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### PATCH /notifications/{id}/read

Mark one notification as read

Authentication: bearer
Operation ID: NotificationsController_markRead

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /notifications/preferences

Get notification preferences

Authentication: bearer
Operation ID: NotificationsController_getPreferences

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### PATCH /notifications/preferences

Update notification preferences

Authentication: bearer
Operation ID: NotificationsController_updatePreferences

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /notifications/read-all

Mark all notifications as read

Authentication: bearer
Operation ID: NotificationsController_markAllRead

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

### payouts

#### GET /payouts

List my payout requests

Authentication: bearer
Operation ID: PayoutsController_list

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /payouts

Submit a payout request

Authentication: bearer
Operation ID: PayoutsController_create

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### POST /payouts/{id}/approve

Approve a payout request (staff)

Authentication: bearer
Operation ID: PayoutsController_approve

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### GET /payouts/{id}/destination

Reveal an approved payout destination to the independent payer

Authentication: bearer
Operation ID: PayoutsController_revealDestination

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /payouts/{id}/mark-paid

Mark approved payout as paid and debit wallet (staff)

Authentication: bearer
Operation ID: PayoutsController_markPaid

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### POST /payouts/{id}/reject

Reject a payout request (staff)

Authentication: bearer
Operation ID: PayoutsController_reject

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### GET /payouts/review

List pending payout requests (staff)

Authentication: bearer
Operation ID: PayoutsController_listReview

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

### queue

#### GET /queue/{robotId}

Get queue for a robot

Authentication: Public
Operation ID: QueueController_getQueue

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |
| header | authorization | Yes | string |  |
| header | cookie | Yes | string |  |
| query | roomAccessToken | Yes | string |  |
| query | guestSessionId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /queue/{robotId}/join

Join the control queue

Authentication: bearer
Operation ID: QueueController_join

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### DELETE /queue/{robotId}/leave

Leave the control queue

Authentication: bearer
Operation ID: QueueController_leave

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /queue/{robotId}/vote/{targetUserId}

Vote for a user in the queue

Authentication: bearer
Operation ID: QueueController_vote

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |
| path | targetUserId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

### robots

#### GET /robots

List all public robots

Authentication: Public
Operation ID: RobotsController_findAll

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| query | status | Yes | string |  |
| query | tag | Yes | string |  |
| query | q | Yes | string |  |
| query | sort | Yes | string |  |
| query | limit | Yes | string |  |
| query | offset | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /robots

Create a new robot

Authentication: bearer
Operation ID: RobotsController_create

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### PUT /robots/{id}

Update robot settings

Authentication: bearer
Operation ID: RobotsController_update

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### DELETE /robots/{id}

Delete a robot

Authentication: bearer
Operation ID: RobotsController_delete

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 204 |  |  |

#### POST /robots/{id}/access/verify

Verify room access and issue a temporary room access grant

Authentication: Public
Operation ID: RobotsController_verifyRoomAccess

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |
| header | authorization | Yes | string |  |
| header | cookie | Yes | string |  |

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### POST /robots/{id}/actions

Enqueue remote robot action (owner only)

Authentication: bearer
Operation ID: RobotRuntimeController_enqueueAction

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### GET /robots/{id}/actions/pending

List pending remote robot actions (owner only)

Authentication: bearer
Operation ID: RobotRuntimeController_getPendingActions

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /robots/{id}/allowed-users

List allow-listed users for a robot (owner only)

Authentication: bearer
Operation ID: RobotsController_getAllowedUsers

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /robots/{id}/allowed-users

Add a user to the robot allow list (owner only)

Authentication: bearer
Operation ID: RobotsController_addAllowedUser

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### DELETE /robots/{id}/allowed-users/{userId}

Remove a user from the robot allow list (owner only)

Authentication: bearer
Operation ID: RobotsController_removeAllowedUser

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |
| path | userId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 204 |  |  |

#### GET /robots/{id}/chat-messages

Get paginated chat history for a robot room

Authentication: Public
Operation ID: RobotsController_getChatHistory

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |
| header | authorization | Yes | string |  |
| header | cookie | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /robots/{id}/ensure-invite

Ensure a stable invite code exists for a robot (owner only)

Authentication: bearer
Operation ID: RobotSecretsController_ensureInviteCode

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### GET /robots/{id}/ingress-cameras

List WHIP camera ingresses for a robot (owner only)

Authentication: bearer
Operation ID: RobotCamerasController_listIngressCameras

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /robots/{id}/ingress-cameras

Create or update a WHIP camera ingress for OBS/manual streaming (owner only)

Authentication: bearer
Operation ID: RobotCamerasController_createIngressCamera

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### DELETE /robots/{id}/ingress-cameras/{ingressId}

Delete an external camera WHIP ingress (owner only)

Authentication: bearer
Operation ID: RobotCamerasController_deleteIngressCamera

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |
| path | ingressId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 204 |  |  |

#### GET /robots/{id}/logs

Get recent temporary robot logs (owner only)

Authentication: bearer
Operation ID: RobotRuntimeController_getLogs

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /robots/{id}/onboarding

Get the server-verified host go-live checklist

Authentication: bearer
Operation ID: RobotsController_getOnboardingStatus

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /robots/{id}/regenerate-invite

Regenerate invite code for link-only access

Authentication: bearer
Operation ID: RobotSecretsController_regenerateInviteCode

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### POST /robots/{id}/regenerate-token

Regenerate claim token

Authentication: bearer
Operation ID: RobotSecretsController_regenerateToken

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### GET /robots/{id}/telemetry

Get recent temporary robot telemetry (owner only)

Authentication: bearer
Operation ID: RobotRuntimeController_getTelemetry

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /robots/{id}/thumbnail

Upload or replace a robot thumbnail (owner only)

Authentication: bearer
Operation ID: RobotsController_uploadThumbnail

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### DELETE /robots/{id}/thumbnail

Remove a robot thumbnail (owner only)

Authentication: bearer
Operation ID: RobotsController_deleteThumbnail

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 204 |  |  |

#### GET /robots/{id}/thumbnail-image

Get a robot thumbnail image

Authentication: Public
Operation ID: RobotsController_getThumbnail

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /robots/{id}/webhooks

List robot webhooks (owner only)

Authentication: bearer
Operation ID: RobotWebhooksController_listWebhooks

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /robots/{id}/webhooks

Create robot webhook (owner only)

Authentication: bearer
Operation ID: RobotWebhooksController_createWebhook

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### DELETE /robots/{id}/webhooks/{webhookId}

Delete robot webhook (owner only)

Authentication: bearer
Operation ID: RobotWebhooksController_deleteWebhook

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |
| path | webhookId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 204 |  |  |

#### GET /robots/{slug}

Get robot by slug (legacy route)

Authentication: Public
Operation ID: RobotsController_findBySlug

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | slug | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /robots/{username}/{slug}

Get robot by owner username + slug

Authentication: Public
Operation ID: RobotsController_findByUsernameAndSlug

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | username | Yes | string |  |
| path | slug | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /robots/actions/poll

Robot polls pending remote actions using robot bearer auth

Authentication: Public
Operation ID: RobotRuntimeController_pollActions

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| header | authorization | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### PUT /robots/admin/{id}

Update robot settings as staff

Authentication: bearer
Operation ID: RobotsController_updateAsStaff

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### DELETE /robots/admin/{id}

Delete robot as staff

Authentication: bearer
Operation ID: RobotsController_deleteAsStaff

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 204 |  |  |

#### POST /robots/claim

Claim a robot and get LiveKit token for hardware client

Authentication: Public
Operation ID: RobotRuntimeController_claim

Parameters

No parameters.

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### GET /robots/featured

Get featured robots

Authentication: Public
Operation ID: RobotsController_getFeatured

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /robots/heartbeat

Heartbeat from robot hardware client

Authentication: Public
Operation ID: RobotRuntimeController_heartbeat

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| header | authorization | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### POST /robots/logs

Robot uploads temporary diagnostics logs using robot bearer auth

Authentication: Public
Operation ID: RobotRuntimeController_pushLogs

Parameters

No parameters.

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### GET /robots/my

Get my robots

Authentication: bearer
Operation ID: RobotsController_getMyRobots

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /robots/overview

Get public robot overview for discovery surfaces

Authentication: Public
Operation ID: RobotsController_getOverview

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /robots/private/{slug}

Get private robot by slug for owner/staff

Authentication: bearer
Operation ID: RobotsController_findPrivateBySlug

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | slug | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /robots/private/{username}/{slug}

Get private robot by owner username + slug for owner/staff

Authentication: bearer
Operation ID: RobotsController_findPrivateByUsernameAndSlug

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | username | Yes | string |  |
| path | slug | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /robots/telemetry

Robot uploads temporary runtime telemetry using robot bearer auth

Authentication: Public
Operation ID: RobotRuntimeController_pushTelemetry

Parameters

No parameters.

Request Body

| Content-Type | Required | Schema |
| --- | --- | --- |
| application/json | Yes | {  } |

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

### sessions

#### GET /sessions/my

Get my session history

Authentication: bearer
Operation ID: SessionsController_getMySessions

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| query | limit | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /sessions/my/{sessionId}

Get detailed session replay data for the authenticated requester

Authentication: bearer
Operation ID: SessionsController_getMySession

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | sessionId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /sessions/robot/{robotId}

Get session history for a robot

Authentication: Public
Operation ID: SessionsController_getByRobot

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |
| query | limit | Yes | string |  |
| header | authorization | Yes | string |  |
| header | cookie | Yes | string |  |
| query | roomAccessToken | Yes | string |  |
| query | guestSessionId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /sessions/robot/{robotId}/active

Get active session for a robot

Authentication: Public
Operation ID: SessionsController_getActiveSession

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | robotId | Yes | string |  |
| header | authorization | Yes | string |  |
| header | cookie | Yes | string |  |
| query | roomAccessToken | Yes | string |  |
| query | guestSessionId | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

### users

#### GET /users/{id}/avatar-image

Get a platform-hosted user avatar

Authentication: Public
Operation ID: UsersController_getAvatar

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /users/{username}

Get user by username

Authentication: Public
Operation ID: UsersController_getByUsername

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | username | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### PATCH /users/admin/{id}

Update user profile/role as staff

Authentication: bearer
Operation ID: UsersController_updateAdminUser

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### DELETE /users/admin/{id}

Delete user account as staff

Authentication: bearer
Operation ID: UsersController_deleteAdminUser

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| path | id | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /users/admin/list

List users for admin/mod dashboard

Authentication: bearer
Operation ID: UsersController_getAdminUsers

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| query | q | Yes | string |  |
| query | limit | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /users/leaderboard

Get credits leaderboard

Authentication: Public
Operation ID: UsersController_getLeaderboard

Parameters

| In | Name | Required | Type | Description |
| --- | --- | --- | --- | --- |
| query | limit | Yes | string |  |
| query | period | Yes | string |  |
| query | metric | Yes | string |  |

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /users/me

Get current user profile

Authentication: bearer
Operation ID: UsersController_getMe

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### PATCH /users/me

Update current user profile

Authentication: bearer
Operation ID: UsersController_updateMe

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### DELETE /users/me

Delete own account (GDPR self-service)

Authentication: bearer
Operation ID: UsersController_deleteMe

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 204 |  |  |

#### POST /users/me/avatar

Upload own avatar to platform storage

Authentication: bearer
Operation ID: UsersController_uploadAvatar

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### DELETE /users/me/avatar

Remove own avatar

Authentication: bearer
Operation ID: UsersController_deleteAvatar

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### POST /users/me/export

Export own account data

Authentication: bearer
Operation ID: UsersController_exportMe

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

### wallet

#### POST /wallet/donations

Donate credits to a robot owner

Authentication: bearer
Operation ID: WalletController_donate

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 201 |  |  |

#### GET /wallet/me

Get current wallet summary (balance + recent transactions)

Authentication: bearer
Operation ID: WalletController_getMe

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /wallet/transactions

List wallet transactions (cursor-paginated)

Authentication: bearer
Operation ID: WalletController_listTransactions

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |

#### GET /wallet/transactions/export

Export the complete filtered wallet ledger

Authentication: bearer
Operation ID: WalletController_exportTransactions

Parameters

No parameters.

Request Body

No request body.

Responses

| Status | Description | Schema |
| --- | --- | --- |
| 200 |  |  |
