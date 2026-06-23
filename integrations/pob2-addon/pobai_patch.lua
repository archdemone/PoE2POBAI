--[[
PoBAI Integration Patch for Path of Building 2
================================================
Adds a "Send to PoBAI" button to the Export section of the Import/Export tab.
Clicking it exports the current build to your local PoBAI server and opens the
chat UI in your default browser.

INSTALL
-------
1. Open: <PoB2 install>/src/Classes/ImportTab.lua
2. Find the line that reads:
       controls.generateCodeOut = new("EditControl", ...
   (search for "generateCodeOut")
3. After that entire block (after the closing ")" for generateCodeOut), paste
   the BUTTON BLOCK below.
4. Before the class definition (search for 'newClass("ImportTab"'), paste
   the HELPER FUNCTIONS block below.
5. Save ImportTab.lua and restart PoB2.

A "Send to PoBAI" button will appear in the Export section below the code box.

REQUIREMENTS
------------
- PoBAI server running: node apps/pobai-server/src/index.mjs  (or npm run dev)
- Node.js 22+
--]]

-- ============================================================
-- HELPER FUNCTIONS  (paste before: newClass("ImportTab", ...))
-- ============================================================

local POBAI_SERVER = "http://localhost:3001"
local POBAI_UI     = "http://localhost:3001"

local function pobai_openBrowser(url)
    -- PoB2 provides launch:OpenURL on all platforms
    if launch.OpenURL then
        launch:OpenURL(url)
    else
        -- Fallback for older builds
        local osName = (jit and jit.os) or ""
        if osName == "Windows" then
            os.execute('start "" "' .. url .. '"')
        elseif osName == "OSX" then
            os.execute('open "' .. url .. '"')
        else
            os.execute('xdg-open "' .. url .. '"')
        end
    end
end

local function pobai_sendBuild(build)
    -- Generate the PoB export code (same method as the Export tab)
    local ok, code = pcall(function()
        return common.base64.encode(
            Deflate(build:SaveDB("code"))
        ):gsub("+", "-"):gsub("/", "_")
    end)

    if not ok or not code or code == "" then
        print("PoBAI: could not generate export code")
        return
    end

    -- Escape the label for JSON
    local label = (build.buildName or "Build"):gsub('\\', '\\\\'):gsub('"', '\\"')

    local jsonBody = '{"source":"pob-code","label":"' .. label .. '","payload":"' .. code .. '"}'

    launch:DownloadPage(
        POBAI_SERVER .. "/api/build/import",
        function(isSuccess, data)
            if isSuccess then
                pobai_openBrowser(POBAI_UI)
            else
                -- Server not running — print to console, don't crash PoB2
                print("PoBAI: server not reachable (" .. tostring(data) .. ")")
                print("Start the server with:  node apps/pobai-server/src/index.mjs")
            end
        end,
        { body = jsonBody, header = "Content-Type: application/json" }
    )
end


-- ============================================================
-- BUTTON BLOCK  (paste after: controls.generateCodeOut = new(...))
-- ============================================================

controls.sendToPoBAI = new("ButtonControl",
    -- Anchor: top-right of generateCodeOut, shifted down 6px
    { "TOPLEFT", controls.generateCodeOut, "BOTTOMLEFT" },
    { 0, 6, 140, 22 },
    "Send to PoBAI",
    function()
        pobai_sendBuild(self.build)
    end
)
controls.sendToPoBAI.tooltipText = "Export this build to PoBAI for AI build advice (opens localhost:3001)"
