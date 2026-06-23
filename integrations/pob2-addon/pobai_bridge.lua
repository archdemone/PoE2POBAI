--[[
PoBAI Bridge v2 — Bidirectional Lua Bridge for Path of Building 2
==================================================================
Replaces pobai_patch.lua. Adds a lightweight HTTP listener inside PoB2
so the PoBAI server can send commands (export build, import build, recalc)
and receive exact calculated stats back.

REQUIRES (bundled with PoB2):
  - socket.dll + socket.lua (LuaSocket)  →  HTTP listener
  - dkjson.lua                           →  JSON encode/decode

INSTALL
-------
Run: node integrations/pob2-addon/install-bridge.mjs
This patches:
  - src/Classes/ImportTab.lua   →  bridge helper functions + listener lifecycle
  - src/Classes/CalcsTab.lua    →  exposes self.calcs globally
--]]

local POBAI_BRIDGE_PORT = 22804
local POBAI_SERVER = "http://localhost:3001"

-- ============================================================
-- JSON helpers (dkjson is bundled with PoB2)
-- ============================================================
local function json_encode(t)
    local ok, json = pcall(function()
        return require("dkjson").encode(t)
    end)
    if ok then return json end
    return '{"error":"json encode failed"}'
end

local function json_decode(s)
    local ok, obj, pos, err = pcall(function()
        return require("dkjson").decode(s)
    end)
    if ok then return obj end
    return nil
end

-- ============================================================
-- Calc runner
-- ============================================================
local function pobai_run_calcs()
    -- Access the calc module exposed by the CalcsTab patch
    local calcs = _G.pobai_calcs_module
    if not calcs then
        return { error = "calc module not available (CalcsTab not initialized)" }
    end

    local build = _G.pobai_current_build
    if not build then
        return { error = "no build loaded" }
    end

    local ok, output = pcall(function()
        return calcs.buildOutput(build, "CALCS")
    end)
    if not ok then
        return { error = tostring(output) }
    end

    -- Extract key stats from the calc output
    local stats = {}
    local player = output and output.player and output.player.output
    if player then
        stats.CombinedDPS = player.CombinedDPS
        stats.Life = player.Life
        stats.LifeUnreserved = player.LifeUnreserved
        stats.LifeRegenRecovery = player.LifeRegenRecovery
        stats.EnergyShield = player.EnergyShield
        stats.EnergyShieldRecoveryCap = player.EnergyShieldRecoveryCap
        stats.EnergyShieldRegenRecovery = player.EnergyShieldRegenRecovery
        stats.Armour = player.Armour
        stats.Evasion = player.Evasion
        stats.ChaosDPS = player.ChaosDPS
        stats.TotalDPS = player.TotalDPS
        stats.Speed = player.Speed
        stats.CritChance = player.CritChance
        stats.CritMultiplier = player.CritMultiplier
        stats.HitChance = player.HitChance
        stats.Accuracy = player.Accuracy
    end

    local minion = output and output.minion and output.minion.output
    if minion then
        stats.Minion = {
            CombinedDPS = minion.CombinedDPS,
            Life = minion.Life,
        }
    end

    return stats
end

-- ============================================================
-- Export build (return base64 export code + XML)
-- ============================================================
local function pobai_export_build()
    local build = _G.pobai_current_build
    if not build then
        return { error = "no build loaded" }
    end

    local ok_xml, xml = pcall(function()
        return build:SaveDB("code")
    end)
    if not ok_xml then
        return { error = "could not export build" }
    end

    local ok_code, code_or_error = pcall(function()
        return common.base64.encode(
            Deflate(xml)
        ):gsub("+", "-"):gsub("/", "_")
    end)

    local stats = pobai_run_calcs()
    local result = {
        ok = true,
        xml = xml,
        buildName = build.buildName or "Untitled",
        stats = stats,
    }

    if ok_code then
        result.exportCode = code_or_error
    else
        result.exportError = tostring(code_or_error)
    end

    return result
end

-- ============================================================
-- Import build (load XML, recalc, return stats)
-- ============================================================
local function pobai_import_build(xmlString)
    local build = _G.pobai_current_build
    if not build then
        return { error = "no build object available" }
    end

    local ok, err = pcall(function()
        build:Init(false, "PoBAI Import", xmlString)
        build.buildFlag = true
    end)
    if not ok then
        return { error = "import failed: " .. tostring(err) }
    end

    -- Give PoB2 a frame to recalculate
    local stats = pobai_run_calcs()
    if stats and stats.error then
        return { error = "import succeeded but calculation failed: " .. tostring(stats.error) }
    end

    return {
        ok = true,
        buildName = build.buildName or "Imported",
        stats = stats,
    }
end

-- ============================================================
-- Command dispatch
-- ============================================================
local function pobai_handle_command(cmd)
    if not cmd or not cmd.action then
        return { error = "missing action field" }
    end

    if cmd.action == "ping" then
        return { ok = true, service = "pob2-bridge", version = "0.2.0" }
    end

    if cmd.action == "get_calcs" then
        local stats = pobai_run_calcs()
        if stats and stats.error then
            return { error = tostring(stats.error) }
        end
        return { ok = true, stats = stats }
    end

    if cmd.action == "export_build" then
        return pobai_export_build()
    end

    if cmd.action == "import_build" or cmd.action == "calculate" then
        if not cmd.xml then
            return { error = "xml field required" }
        end
        return pobai_import_build(cmd.xml)
    end

    return { error = "unknown action: " .. tostring(cmd.action) }
end

-- ============================================================
-- HTTP Listener (via LuaSocket, non-blocking)
-- ============================================================
local pobai_listener = nil
local pobai_listener_running = false

function pobai_start_listener()
    local ok, socket = pcall(function()
        return require("socket")
    end)
    if not ok then
        print("PoBAI Bridge: LuaSocket not available (" .. tostring(socket) .. ")")
        print("PoBAI Bridge: falling back to file-based polling")
        return false
    end

    local ok2, srv = pcall(function()
        local s = socket.tcp()
        s:settimeout(0)  -- non-blocking
        s:bind("127.0.0.1", POBAI_BRIDGE_PORT)
        s:listen(1)
        return s
    end)

    if not ok2 then
        print("PoBAI Bridge: could not bind to 127.0.0.1:" .. POBAI_BRIDGE_PORT .. " (" .. tostring(srv) .. ")")
        return false
    end

    pobai_listener = srv
    pobai_listener_running = true
    print("PoBAI Bridge: HTTP listener on 127.0.0.1:" .. POBAI_BRIDGE_PORT)
    return true
end

function pobai_poll_listener()
    if not pobai_listener_running or not pobai_listener then
        return
    end

    -- Non-blocking accept
    local ok, client = pcall(function()
        return pobai_listener:accept()
    end)
    if not ok or not client then
        return  -- no pending connection
    end

    client:settimeout(2)  -- 2s timeout for receiving the request

    -- Read the HTTP request (up to 64KB)
    local ok_req, request_line = pcall(function()
        return client:receive("*l")  -- read the request line
    end)
    if not ok_req or not request_line then
        client:close()
        return
    end

    -- Read headers
    local headers = {}
    while true do
        local ok_hdr, line = pcall(function()
            return client:receive("*l")
        end)
        if not ok_hdr or line == nil or line == "" then break end
        table.insert(headers, line)
    end

    -- Read body (content-length)
    local content_length = 0
    for _, h in ipairs(headers) do
        local len = h:match("^[Cc]ontent%-[Ll]ength:%s*(%d+)")
        if len then content_length = tonumber(len) end
    end

    local body = ""
    if content_length and content_length > 0 then
        local ok_body, raw = pcall(function()
            return client:receive(content_length)
        end)
        if ok_body then body = raw end
    end

    -- Parse command
    local cmd = json_decode(body)
    local result = pobai_handle_command(cmd)
    local response_body = json_encode(result)

    -- Build HTTP response
    local response = "HTTP/1.1 200 OK\r\n"
        .. "Content-Type: application/json\r\n"
        .. "Content-Length: " .. #response_body .. "\r\n"
        .. "Connection: close\r\n"
        .. "\r\n"
        .. response_body

    local ok_send, send_err = pcall(function()
        client:send(response)
    end)
    if not ok_send then
        print("PoBAI Bridge: send failed (" .. tostring(send_err) .. ")")
    end

    client:close()
end

function pobai_stop_listener()
    pobai_listener_running = false
    if pobai_listener then
        pcall(function()
            pobai_listener:close()
        end)
        pobai_listener = nil
    end
    print("PoBAI Bridge: listener stopped")
end

-- ============================================================
-- Chat overlay (simple text input + response area)
-- ============================================================
local pobai_chat_input = ""
local pobai_chat_response = ""

local function pobai_chat_send(message)
    if not message or message == "" then return end
    pobai_chat_response = "Sending..."

    local jsonBody = json_encode({
        model = "anthropic/claude-sonnet-4",
        apiKey = "",
        messages = {
            { role = "user", content = message },
        },
    })

    launch:DownloadPage(
        POBAI_SERVER .. "/api/chat",
        function(isSuccess, data)
            if isSuccess then
                local ok_parse, parsed = pcall(function()
                    return require("dkjson").decode(data)
                end)
                if ok_parse and parsed and parsed.message then
                    pobai_chat_response = parsed.message.content
                else
                    pobai_chat_response = "Parse error"
                end
            else
                pobai_chat_response = "Server error: " .. tostring(data)
            end
        end,
        { body = jsonBody, header = "Content-Type: application/json" }
    )
end

-- ============================================================
-- Controls (added to ImportTab)
-- ============================================================
-- Export via button (same as v1, keeps existing behavior)
-- controls.sendToPoBAI = new("ButtonControl", ...)
-- controls.pobaiChatInput = new("EditControl", ...)
-- controls.pobaiChatSend = new("ButtonControl", ...)
-- controls.pobaiChatResponse = new("EditControl", ...)

-- ============================================================
-- Exported API for the installer hook
-- ============================================================
_G.pobai_bridge = {
    start = pobai_start_listener,
    stop = pobai_stop_listener,
    poll = pobai_poll_listener,
    handle_command = pobai_handle_command,
    export = pobai_export_build,
    import = pobai_import_build,
    calc = pobai_run_calcs,
    chat_send = pobai_chat_send,
}

return _G.pobai_bridge
