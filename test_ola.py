import requests
import json
url = "https://api.olamaps.io/places/v1/geocode?address=Bandra,Mumbai&api_key=NkHSBWASVRCLzAPAxyuMXetkKyCoFfWcVWo0kwfe"
headers = {"X-Request-Id": "123456"}
res = requests.get(url, headers=headers)
print("status:", res.status_code)
print(res.text)
