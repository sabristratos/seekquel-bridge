$ErrorActionPreference = 'Stop'

$Image = if ($env:SEEKQUEL_BRIDGE_IMAGE) { $env:SEEKQUEL_BRIDGE_IMAGE } else { 'ghcr.io/sabristratos/seekquel-bridge:latest' }
$Name = 'seekquel-bridge'
$Volume = 'seekquel-bridge-data'
$Port = if ($env:SEEKQUEL_BRIDGE_PORT) { $env:SEEKQUEL_BRIDGE_PORT } else { '4410' }
$AbsInternalPort = '80'

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
$absLine = docker ps --format '{{.ID}} {{.Image}} {{.Names}}' |
    Where-Object { $_ -match 'audiobookshelf' -and $_ -notmatch $Name } |
    Select-Object -First 1

if ($absLine) {
    $absId = ($absLine -split ' ')[0]
    $absName = (docker inspect -f '{{.Name}}' $absId).TrimStart('/')
    $absNetwork = ((docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' $absId) -split ' ')[0]

    if ($absNetwork -and $absNetwork -notin @('bridge', 'host', 'none')) {
        $networkArgs = @('--network', $absNetwork)
        $addressArgs = @('-e', "ABS_URL=http://${absName}:$AbsInternalPort")
    }
    else {
        $published = docker port $absId $AbsInternalPort 2> $null | Select-Object -First 1
        if ($published) {
            $hostPort = ($published -split ':')[-1]
            $addressArgs = @('-e', "ABS_URL=http://host.docker.internal:$hostPort")
        }
    }

    Write-Output "Found Audiobookshelf running as `"$absName`"."
}
else {
    Write-Output 'No Audiobookshelf container found on this machine. You can type its address on the next page.'
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

$address = "http://localhost:$Port"

Write-Output ''
Write-Output 'Seekquel Bridge is running. Finish in the page that just opened (two short steps):'
Write-Output ''
Write-Output "  $address"
Write-Output ''
Write-Output 'It starts by itself after a restart. To update it later, run this same command again.'

Start-Process $address
