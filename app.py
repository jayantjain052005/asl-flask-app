import os
import time
import glob
import logging
from flask import Flask, render_template, Response, jsonify, request, send_file, redirect, session

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config["SECRET_KEY"] = "signai-dual-2024"

# ── Boot ──────────────────────────────────────────
from predictor import DualPredictor
from camera import CameraStream

dual = DualPredictor()
camera = CameraStream(camera_index=0, dual_predictor=dual)

# ──────────────────────────────────────────────────
# 🔐 AUTH ROUTES
# ──────────────────────────────────────────────────

@app.route("/")
def login_page():
    return render_template("login.html")


@app.route("/login", methods=["POST"])
def do_login():
    username = request.form.get("username")
    password = request.form.get("password")

    print("LOGIN ATTEMPT:", username, password)

    if username == "root" and password == "root":
        session["user"] = username
        return redirect("/home")
    else:
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

# ──────────────────────────────────────────────────
# 🎥 CAMERA API (UNCHANGED)
# ──────────────────────────────────────────────────

@app.route("/api/camera/start", methods=["POST"])
def camera_start():
    return jsonify(camera.start())


@app.route("/api/camera/stop", methods=["POST"])
def camera_stop():
    camera.stop()
    return jsonify({"ok": True})


@app.route("/api/camera/status")
def camera_status():
    return jsonify({
        "running": camera.is_running(),
        "mode": camera.get_mode(),
        "words_ready": dual.words_pred is not None,
        "alpha_ready": dual.alpha_pred is not None,
        "words_error": dual.words_error,
        "alpha_error": dual.alpha_error,
        "words_classes": dual.words_classes,
        "alpha_classes": dual.alpha_classes,
    })


@app.route("/api/mode/<mode>", methods=["POST"])
def set_mode(mode):
    if mode not in ("words", "alpha"):
        return jsonify({"ok": False, "message": "Unknown mode"}), 400
    camera.set_mode(mode)
    return jsonify({"ok": True, "mode": mode})


@app.route("/video_feed")
def video_feed():
    def generate():
        while True:
            if camera.is_running():
                frame = camera.get_frame()
                if frame:
                    yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n")
            time.sleep(0.03)

    return Response(generate(), mimetype="multipart/x-mixed-replace; boundary=frame")


@app.route("/api/prediction")
def get_prediction():
    if not camera.is_running():
        return jsonify({
            "sign": None,
            "confidence": 0.0,
            "raw_confidence": 0.0,
            "all_probs": {},
            "stable": False,
            "hand_count": 0,
            "fps": 0.0,
            "message": "Camera not running",
            "mode": camera.get_mode()
        })

    return jsonify(camera.get_prediction())


@app.route("/api/snapshot")
def snapshot():
    data = camera.get_snapshot()
    if data:
        return jsonify({"ok": True, "image": data})
    return jsonify({"ok": False, "message": "No frame available"}), 400


# ──────────────────────────────────────────────────
# 🖼 SIGN IMAGE SERVING
# ──────────────────────────────────────────────────

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

    return Response(svg, mimetype="image/svg+xml")


# ──────────────────────────────────────────────────
# 🚀 RUN
# ──────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))

    print("\n" + "=" * 50)
    print("🤟 Sign Language AI Detector")
    print(f"▶ http://localhost:{port}")
    print("=" * 50 + "\n")

    app.run(host="0.0.0.0", port=port, debug=True)