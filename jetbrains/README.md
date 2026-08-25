# JetBrains adapter

The Kotlin adapter registers a `FileEditorProvider`, serves packaged Viewer resources and current document bytes from the private `https://docviewkit-omni.invalid` JCEF origin, reloads on VFS changes, and disposes the browser/query with the editor. If JCEF is unavailable it shows a native diagnostic and does not fall back to an image or remote service.

Build with `JAVA_HOME=/path/to/jdk-21 ./gradlew clean test buildPlugin verifyPluginStructure`.
