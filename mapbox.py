import requests
import os

ACCESS_TOKEN = os.getenv("MAPBOX_ACCESS_TOKEN") or os.getenv("MAPBOX_TOKEN")

# Example style from your URL
STYLE_URL = "https://api.mapbox.com/styles/v1/yaak-driving-curriculum/cm6up5as0019a01r5e6n33wmn"

def test_token():
    if not ACCESS_TOKEN:
        print("❌ Missing MAPBOX_ACCESS_TOKEN (or MAPBOX_TOKEN) in environment")
        return

    params = {
        "access_token": ACCESS_TOKEN
    }

    try:
        response = requests.get(STYLE_URL, params=params)

        print(f"Status Code: {response.status_code}")

        if response.status_code == 200:
            print("✅ Token is valid and working.")
            data = response.json()
            print(f"Style name: {data.get('name')}")
        elif response.status_code == 401:
            print("❌ Unauthorized — token invalid or expired.")
        elif response.status_code == 403:
            print("⚠️ Forbidden — token exists but lacks permissions.")
        else:
            print("ℹ️ Unexpected response:")
            print(response.text)

    except Exception as e:
        print("Error occurred:", str(e))
def test_geocoding():
    if not ACCESS_TOKEN:
        print("❌ Missing MAPBOX_ACCESS_TOKEN (or MAPBOX_TOKEN) in environment")
        return

    url = "https://api.mapbox.com/geocoding/v5/mapbox.places/Mumbai.json"
    params = {
        "access_token": ACCESS_TOKEN,
        "limit": 1
    }

    try:
        response = requests.get(url, params=params, timeout=10)

        print("\n[Geocoding Test]")
        print("Status Code:", response.status_code)

        if response.status_code == 200:
            data = response.json()

            if data.get("features"):
                place = data["features"][0]["place_name"]
                coords = data["features"][0]["geometry"]["coordinates"]

                print("✅ Geocoding works")
                print("Place:", place)
                print("Coordinates:", coords)
            else:
                print("⚠️ No results returned")

        elif response.status_code == 403:
            print("❌ Token blocked for geocoding (restricted)")

        elif response.status_code == 401:
            print("❌ Invalid or expired token")

        else:
            print("Unexpected response:", response.text[:300])

    except Exception as e:
        print("Error:", str(e))


if __name__ == "__main__":
    test_token()
    test_geocoding()