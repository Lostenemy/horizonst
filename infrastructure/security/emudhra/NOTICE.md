# eMudhra trust backport
Public trust data from official Hex certifi 2.18.0.
Archive SHA256: a8b61115e393a2298b20451a36beffdabe08e61bc16cc1926d7991f6721103bf.
Source: https://hex.pm/api/packages/certifi/releases/2.18.0
Public chain fixtures: https://emudhra.we-have-a-problem.com/chains.zip
Regression verification uses fixed 2026-10-24T12:00:00Z to prevent fixture expiry from masquerading as distrust. Runtime TLS verification is not disabled or frozen.
This backports CA data into the existing OTP25 certifi API; it does not claim an official VerneMQ/OTP upgrade.
