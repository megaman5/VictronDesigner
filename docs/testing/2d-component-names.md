# 2D component name clipping verification

Verified October 1, 2026 on the rebuilt production app at
https://www.victrondesigner.com/ using the collaborative preview browser.

The component artwork SVG previously clipped centered names to the symbol's
fixed viewport. Component SVGs now allow overflow; geometry and terminal
positions remain unchanged.

The prepared fixture contained two solar panels (one rotated 180 degrees),
an inverter, and a battery with long names. At 100% zoom, all four names were
visible outside their SVG boundaries. Measured label widths were 244–307px
against 140–160px symbol viewports, with computed overflow `visible` on every
symbol. Terminal counts remained 2, 2, 5, and 2. Zooming out twice kept the names
visible. The intentionally unwired fixture produces unrelated validation
outlines. Original diagram storage was restored after testing.

`npm run build` passed, the systemd service was restarted, and the local page
returned HTTP 200. Both existing component test suites passed: 29 tests.

![Full names at 100% zoom](/home/sean/.t3/userdata/browser-artifacts/browser-screenshot-www-victrondesigner-com-mupxuz2g-11c80551.png)

![Full names after zooming out](/home/sean/.t3/userdata/browser-artifacts/browser-screenshot-www-victrondesigner-com-mupxverp-59e8679b.png)

[Browser recording](/home/sean/.t3/userdata/attachments/ce96cda2-5592-4efc-b554-0619af086ed4-037464b3-69b0-4c68-b0d0-a39857ce09d3-mp4.mp4)
