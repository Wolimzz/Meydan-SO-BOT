-- Place this Script in ServerScriptService.
-- Enable HTTP Requests in Game Settings > Security.

local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")

local API_URL = "https://YOUR-RAILWAY-DOMAIN/roblox/heartbeat"
local SHUTDOWN_URL = "https://YOUR-RAILWAY-DOMAIN/roblox/shutdown"
local API_KEY = "YOUR_LONG_RANDOM_SECRET"
local HEARTBEAT_SECONDS = 15

local function request(url, payload)
    local ok, response = pcall(function()
        return HttpService:RequestAsync({
            Url = url,
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json",
                ["x-roblox-key"] = API_KEY,
            },
            Body = HttpService:JSONEncode(payload),
        })
    end)

    if not ok then
        warn("[DiscordStats] HTTP error:", response)
        return false
    end

    if not response.Success then
        warn("[DiscordStats] HTTP status:", response.StatusCode, response.Body)
        return false
    end

    return true
end

local function heartbeat()
    return request(API_URL, {
        jobId = game.JobId,
        placeId = tostring(game.PlaceId),
        playerCount = #Players:GetPlayers(),
    })
end

heartbeat()

while task.wait(HEARTBEAT_SECONDS) do
    heartbeat()
end

-- BindToClose is best-effort; heartbeats also expire automatically server-side.
game:BindToClose(function()
    request(SHUTDOWN_URL, { jobId = game.JobId })
end)
