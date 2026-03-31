"""Main BotParty robot client – connects to LiveKit and handles commands."""

import asyncio
import json
import logging
import time

import aiohttp
from livekit import api as lkapi, rtc

from .config import RobotConfig
from .handlers import DefaultHandler

logger = logging.getLogger("botparty.client")


class BotPartyClient:
    def __init__(self, config: RobotConfig) -> None:
        self.config = config
        self.handler = DefaultHandler(config.controls, config.safety)
        self._running = False
        self._room: rtc.Room | None = None
        self._last_command_time: float = 0

    async def run(self) -> None:
        """Main loop: authenticate, connect to LiveKit, handle commands."""
        self._running = True

        # 1. Authenticate with the API to get LiveKit token
        token, robot_id = await self._authenticate()
        if not token:
            logger.error("Authentication failed. Check your claim_token.")
            return

        logger.info(f"✅ Authenticated as robot {robot_id}")

        # 2. Connect to LiveKit room
        self._room = rtc.Room()

        @self._room.on("data_received")
        def on_data(data: rtc.DataPacket):
            self._handle_data(data)

        @self._room.on("disconnected")
        def on_disconnected():
            logger.warning("Disconnected from LiveKit room")
            if self._running:
                asyncio.create_task(self._reconnect(token))

        try:
            await self._room.connect(self.config.server.livekit_url, token)
            logger.info(f"🎥 Connected to LiveKit room: robot-{robot_id}")

            # 3. Publish camera track
            await self._publish_camera()

            # 4. Start safety watchdog
            asyncio.create_task(self._safety_watchdog())

            # 5. Keep running
            while self._running:
                await asyncio.sleep(1)

        except Exception as e:
            logger.error(f"LiveKit connection error: {e}")
        finally:
            await self.shutdown()

    async def _authenticate(self) -> tuple[str | None, str | None]:
        """Get LiveKit token from BotParty API using claim token."""
        url = f"{self.config.server.api_url}/api/v1/livekit/token/robot"
        try:
            async with aiohttp.ClientSession() as session:
                # First, claim the robot via WebSocket-style auth
                # For simplicity, we use a direct API call here
                async with session.post(
                    f"{self.config.server.api_url}/api/v1/robots/claim",
                    json={"claimToken": self.config.server.claim_token},
                    headers={"Content-Type": "application/json"},
                ) as resp:
                    if resp.status != 200 and resp.status != 201:
                        text = await resp.text()
                        logger.error(f"Claim failed ({resp.status}): {text}")
                        return None, None
                    data = await resp.json()
                    return data.get("token"), data.get("robotId")
        except Exception as e:
            logger.error(f"Authentication error: {e}")
            return None, None

    async def _publish_camera(self) -> None:
        """Publish camera video track to LiveKit room."""
        try:
            source = rtc.VideoSource(self.config.camera.width, self.config.camera.height)
            track = rtc.LocalVideoTrack.create_video_track("camera", source)

            options = rtc.TrackPublishOptions(
                source=rtc.TrackSource.SOURCE_CAMERA,
            )

            if self._room:
                await self._room.local_participant.publish_track(track, options)
                logger.info("📹 Camera track published")

                # Start camera capture loop
                asyncio.create_task(self._camera_loop(source))

        except Exception as e:
            logger.error(f"Camera publish error: {e}")

    async def _camera_loop(self, source: rtc.VideoSource) -> None:
        """Capture frames from camera and send to LiveKit."""
        try:
            import cv2
        except ImportError:
            logger.error("OpenCV not installed. Install with: pip install opencv-python-headless")
            return

        device = self.config.camera.device
        cap = cv2.VideoCapture(0 if device == "/dev/video0" else device)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.config.camera.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.config.camera.height)
        cap.set(cv2.CAP_PROP_FPS, self.config.camera.fps)

        if not cap.isOpened():
            logger.error(f"Could not open camera: {device}")
            return

        logger.info(f"📷 Camera opened: {device} ({self.config.camera.width}x{self.config.camera.height}@{self.config.camera.fps}fps)")

        interval = 1.0 / self.config.camera.fps
        while self._running:
            ret, frame = cap.read()
            if not ret:
                await asyncio.sleep(0.01)
                continue

            # Convert BGR to RGBA for LiveKit
            import numpy as np
            frame_rgba = cv2.cvtColor(frame, cv2.COLOR_BGR2RGBA)
            lk_frame = rtc.VideoFrame(
                self.config.camera.width,
                self.config.camera.height,
                rtc.VideoBufferType.RGBA,
                frame_rgba.tobytes(),
            )
            source.capture_frame(lk_frame)
            await asyncio.sleep(interval)

        cap.release()

    def _handle_data(self, data: rtc.DataPacket) -> None:
        """Handle incoming DataChannel commands from controllers."""
        try:
            payload = json.loads(data.data.decode("utf-8"))
            command = payload.get("command", "")
            value = payload.get("value")
            timestamp = payload.get("timestamp", 0)

            # Latency check
            latency_ms = (time.time() * 1000) - timestamp
            if latency_ms > self.config.safety.latency_threshold_ms:
                logger.warning(f"⚠️ High latency: {latency_ms:.0f}ms – triggering E-STOP")
                self.handler.emergency_stop()
                return

            self._last_command_time = time.time()
            self.handler.on_command(command, value)
            logger.debug(f"CMD: {command}={value} (latency: {latency_ms:.0f}ms)")

        except Exception as e:
            logger.error(f"Data handling error: {e}")

    async def _safety_watchdog(self) -> None:
        """Auto-stop the robot if no commands received within timeout."""
        timeout_sec = self.config.safety.max_run_time_ms / 1000.0
        while self._running:
            await asyncio.sleep(0.5)
            if self._last_command_time > 0:
                elapsed = time.time() - self._last_command_time
                if elapsed > timeout_sec:
                    logger.info("⏱️ Command timeout – auto-stopping motors")
                    self.handler.emergency_stop()
                    self._last_command_time = 0

    async def _reconnect(self, token: str) -> None:
        """Attempt to reconnect to LiveKit."""
        logger.info("🔄 Attempting reconnect in 5 seconds...")
        await asyncio.sleep(5)
        if self._running and self._room:
            try:
                await self._room.connect(self.config.server.livekit_url, token)
                logger.info("✅ Reconnected")
            except Exception as e:
                logger.error(f"Reconnect failed: {e}")

    async def shutdown(self) -> None:
        """Gracefully shut down the client."""
        logger.info("🛑 Shutting down...")
        self._running = False
        self.handler.emergency_stop()
        if self._room:
            await self._room.disconnect()
        logger.info("👋 Goodbye!")
