$ErrorActionPreference = 'Stop'

$Image = if ($env:SEEKQUEL_BRIDGE_IMAGE) { $env:SEEKQUEL_BRIDGE_IMAGE } else { 'ghcr.io/sabristratos/seekquel-bridge:latest' }
$Name = 'seekquel-bridge'
$Volume = 'seekquel-bridge-data'
$Port = if ($env:SEEKQUEL_BRIDGE_PORT) { $env:SEEKQUEL_BRIDGE_PORT } else { '4410' }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Output 'Docker is not installed. Install Docker Desktop, then run this again.'
    exit 1
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Output 'Docker is installed but not running. Start Docker Desktop, then run this again.'
    exit 1
}

$networkArgs = @()
$addressArgs = @()
$extraNetworks = @()
$found = @()

function Find-Server([string]$Pattern, [string]$InternalPort, [string]$EnvName, [string]$Label) {
    $line = docker ps --format '{{.ID}} {{.Image}} {{.Names}}' |
        Where-Object { $_ -match $Pattern -and $_ -notmatch $Name } |
        Select-Object -First 1

    if (-not $line) {
        return
    }

    $id = ($line -split ' ')[0]
    $serverName = (docker inspect -f '{{.Name}}' $id).TrimStart('/')
    $network = ((docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' $id) -split ' ')[0]

    if ($network -and $network -notin @('bridge', 'host', 'none')) {
        if ($script:networkArgs.Count -eq 0) {
            $script:networkArgs = @('--network', $network)
        }
        elseif ($script:networkArgs[1] -ne $network) {
            $script:extraNetworks += $network
        }
        $script:addressArgs += @('-e', "$EnvName=http://${serverName}:$InternalPort")
    }
    else {
        $published = docker port $id $InternalPort 2> $null | Select-Object -First 1
        if ($published) {
            $hostPort = ($published -split ':')[-1]
            $script:addressArgs += @('-e', "$EnvName=http://host.docker.internal:$hostPort")
        }
    }

    $script:found += $Label
    Write-Output "Found $Label running as `"$serverName`"."
}

Find-Server 'audiobookshelf' '80' 'ABS_URL' 'Audiobookshelf'
Find-Server 'storyteller' '8001' 'STORYTELLER_URL' 'Storyteller'

if ($found.Count -eq 0) {
    Write-Output 'No Audiobookshelf or Storyteller container found on this machine. You can type its address on the next page.'
}

if ($Image -match '/') {
    docker pull -q $Image | Out-Null
}

docker rm -f $Name *> $null

$runArgs = @(
    'run', '-d',
    '--name', $Name,
    '--restart', 'unless-stopped',
    '--add-host', 'host.docker.internal:host-gateway',
    '-v', "${Volume}:/data",
    '-p', "${Port}:4410"
) + $networkArgs + $addressArgs + @($Image)

docker @runArgs | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Output 'Seekquel Bridge could not be started. The message above says why.'
    exit 1
}

foreach ($network in $extraNetworks) {
    docker network connect $network $Name | Out-Null
}

$address = "http://localhost:$Port"

Write-Output ''
Write-Output 'Seekquel Bridge is running. Finish in the page that just opened (two short steps):'
Write-Output ''
Write-Output "  $address"
Write-Output ''
Write-Output 'It starts by itself after a restart. To update it later, run this same command again.'

Start-Process $address
