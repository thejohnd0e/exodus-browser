# Wordmark Display Crop

**Intent:** Make the supplied Exodus Browser wordmark visibly fill the sidebar's existing logo area, matching the browser preview the user approved.

**Goals:** Crop the artwork's internal empty margins at display time, scale proportionally, and use nearly the full available sidebar width. Since the source PNG has substantially more empty background on the right, crop that excess so the visible artwork has approximately equal 1–2 mm margins at the left, right, and top. Keep the provided PNG and native window/favicon assets unchanged.

**Non-goals:** Redraw or edit the artwork, change sidebar width/navigation, or alter other app behavior.

**Approach:** Keep the existing wordmark image and accessible name; render it in a fixed-height clipped viewport and scale/offset the image so its content occupies the viewport. Verify the rendered dimensions and asset contract in Electron.

**Acceptance:** The emblem and wordmark fill nearly the whole sidebar logo area with approximately equal visible left/right/top margins and no distortion; existing branding and responsive sidebar tests pass.
