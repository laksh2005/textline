{
  "targets": [
    {
      "target_name": "uia",
      "sources": ["uia.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "UNICODE", "_UNICODE"],
      "libraries": ["ole32.lib", "oleaut32.lib", "uiautomationcore.lib", "user32.lib"],
      "msvs_settings": {
        "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++17"] }
      }
    }
  ]
}
