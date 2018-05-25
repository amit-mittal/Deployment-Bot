Param
(
    # OS String version {Ex: OS141.0.8}
    [parameter(Mandatory = $true)]
    [String[]]
    $tfsIds = "",
    
    # Parent Deployment Id {Ex: 5391754}
    [parameter(Mandatory = $false)]
    [String]
    $action = "retry"
)

Write-Host "Parameters received $tfsIds $action"
