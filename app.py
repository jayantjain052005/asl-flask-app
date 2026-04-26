import os
import glob
import logging
import base64
import numpy as np
import cv2
import mediapipe as mp
from flask import Flask, render_template, jsonify, request, send_file, redirect, session, Response
from predictor import DualPredictor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config["SECRET_KEY"] = "signai-dual-2024"

dual = DualPredictor()

# ─────────────────────────────
# Mediapipe
# ─────────────────────────────
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(max_num_hands=2)

# ─────────────────────────────
# GLOBAL FRAME STORE
# ─────────────────────────────
latest_frame = None
latest_result = None
camera_running = False

# ─────────────────────────────
# AUTH
# ─────────────────────────────
@app.route("/")
def login_page():
    return render_template("login.html")

@app.route("/login", methods=["POST"])
def do_login():
    if request.form.get("username") == "root" and request.form.get("password") == "root":
        session["user"] = "root"
        return redirect("/home")
    return "Invalid login", 401

@app.route("/home")
def home():
    if "user" not in session:
        return redirect("/")
    return render_template(
        "index.html",
        words_classes=dual.words_classes,
        alpha_classes=dual.alpha_classes
    )

# ─────────────────────────────
# FAKE CAMERA START
# ─────────────────────────────
@app.route("/api/camera/start", methods=["POST"])
def start_camera():
    global camera_running
    camera_running = True
    return jsonify({"status": "started"})

@app.route("/api/camera/stop", methods=["POST"])
def stop_camera():
    global camera_running
    camera_running = False
    return jsonify({"status": "stopped"})

# ─────────────────────────────
# RECEIVE FRAME FROM FRONTEND
# ─────────────────────────────
@app.route("/api/upload_frame", methods=["POST"])
def upload_frame():
    global latest_frame, latest_result

    try:
        data = request.json["image"]
        mode = request.json.get("mode", "words")

        img_data = base64.b64decode(data.split(",")[1])
        np_arr = np.frombuffer(img_data, np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        latest_frame = frame

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb)

        latest_result = dual.predict(results, mode)

        return jsonify({"status": "ok"})

    except Exception as e:
        return jsonify({"error": str(e)})

# ─────────────────────────────
# VIDEO FEED (FAKE STREAM)
# ─────────────────────────────
def generate_frames():
    global latest_frame

    while True:
        if latest_frame is None:
            continue

        ret, buffer = cv2.imencode(".jpg", latest_frame)
        frame = buffer.tobytes()

        yield (b"--frame\r\n"
               b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n")

@app.route("/video_feed")
def video_feed():
    return Response(generate_frames(),
                    mimetype="multipart/x-mixed-replace; boundary=frame")

# ─────────────────────────────
# PREDICTION API (UNCHANGED UI)
# ─────────────────────────────
@app.route("/api/prediction")
def get_prediction():
    global latest_result

    if latest_result is None:
        return jsonify({
            "sign": None,
            "confidence": 0,
            "message": "Waiting for camera..."
        })

    return jsonify(latest_result)

# ─────────────────────────────
# IMAGE SERVING (UNCHANGED)
# ─────────────────────────────
DATASETS = {
    "words": "dataset",
    "alpha": "dataset"
}

def _find_image(sign_name, mode):
    folder = os.path.join(DATASETS.get(mode, "dataset"), sign_name)

    if not os.path.isdir(folder):
        return None

    imgs = []
    for ext in ("*.jpg", "*.png"):
        imgs.extend(glob.glob(os.path.join(folder, ext)))

    return imgs[0] if imgs else None

@app.route("/api/sign_image/<mode>/<sign_name>")
def sign_image(mode, sign_name):
    path = _find_image(sign_name, mode)
    if path:
        return send_file(path)
    return "", 404

# ─────────────────────────────
# RUN
# ─────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
