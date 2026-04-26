import os
import glob
import logging
import base64
import numpy as np
import cv2
import mediapipe as mp

from flask import (
    Flask, render_template, jsonify,
    request, send_file, redirect, session
)

# ────────────────────────────────────────────────
# 🔧 CONFIG
# ────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config["SECRET_KEY"] = "signai-dual-2024"

# ────────────────────────────────────────────────
# 🤖 LOAD MODEL
# ────────────────────────────────────────────────
from predictor import DualPredictor

dual = DualPredictor()

# ────────────────────────────────────────────────
# ✋ MEDIAPIPE SETUP
# ────────────────────────────────────────────────
mp_hands = mp.solutions.hands

hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=2,
    model_complexity=0,
    min_detection_confidence=0.65,
    min_tracking_confidence=0.55,
)

# ────────────────────────────────────────────────
# 🔐 AUTH ROUTES
# ────────────────────────────────────────────────

@app.route("/")
def login_page():
    return render_template("login.html")


@app.route("/login", methods=["POST"])
def do_login():
    username = request.form.get("username")
    password = request.form.get("password")

    if username == "root" and password == "root":
        session["user"] = username
        return redirect("/home")

    return "Invalid login", 401


@app.route("/home")
def home():
    if "user" not in session:
        return redirect("/")

    return render_template(
        "index.html",
        words_classes=dual.words_classes,
        alpha_classes=dual.alpha_classes,
        words_error=dual.words_error,
        alpha_error=dual.alpha_error,
    )


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


# ────────────────────────────────────────────────
# 🔥 NEW: FRAME PREDICTION API (BROWSER CAMERA)
# ────────────────────────────────────────────────

@app.route("/predict_frame", methods=["POST"])
def predict_frame():
    try:
        data = request.json.get("image")
        mode = request.json.get("mode", "words")

        if not data:
            return jsonify({"error": "No image received"}), 400

        # Decode base64 image
        img_data = base64.b64decode(data.split(",")[1])
        np_arr = np.frombuffer(img_data, np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        # Process with MediaPipe
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb)

        # Predict using your model
        prediction = dual.predict(results, mode)

        return jsonify(prediction)

    except Exception as e:
        logger.error(f"Prediction error: {e}")
        return jsonify({"error": str(e)}), 500


# ────────────────────────────────────────────────
# 🖼 SIGN IMAGE SERVING (UNCHANGED)
# ────────────────────────────────────────────────

DATASETS = {
    "words": "dataset",
    "alpha": "dataset_alpha",
}


def _find_image(sign_name: str, mode: str):
    folder = os.path.join(DATASETS.get(mode, "dataset"), sign_name)

    if not os.path.isdir(folder):
        for ds in DATASETS.values():
            folder = os.path.join(ds, sign_name)
            if os.path.isdir(folder):
                break
        else:
            return None

    imgs = []
    for ext in ("*.jpg", "*.jpeg", "*.png"):
        imgs.extend(glob.glob(os.path.join(folder, ext)))

    if not imgs:
        return None

    imgs.sort()
    return imgs[len(imgs) // 2]


@app.route("/api/sign_image/<mode>/<path:sign_name>")
def sign_image(mode, sign_name):
    path = _find_image(sign_name, mode)

    if path and os.path.exists(path):
        return send_file(path, mimetype="image/jpeg")

    # fallback SVG
    letter = sign_name[0].upper()
    svg = f'''
    <svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">
        <rect width="200" height="150" fill="#161a22"/>
        <text x="100" y="80" font-size="40" fill="#c9a84c" text-anchor="middle">{letter}</text>
    </svg>
    '''

    return app.response_class(svg, mimetype="image/svg+xml")


# ────────────────────────────────────────────────
# 🚀 RUN
# ────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))

    print("\n" + "=" * 50)
    print("🤟 Sign Language AI Detector (Browser Camera Mode)")
    print(f"▶ http://localhost:{port}")
    print("=" * 50 + "\n")

    app.run(host="0.0.0.0", port=port, debug=True)
