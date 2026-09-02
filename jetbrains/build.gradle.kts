import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.intellij.platform")
}

group = "com.docviewkit.omni"
version = "0.1.16"

dependencies {
    testImplementation("junit:junit:4.13.2")
    intellijPlatform {
        intellijIdea("2025.2.6.2")
        testFramework(TestFrameworkType.Platform)
    }
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion { sinceBuild = "252" }
    }
    pluginVerification {
        ides { current() }
    }
}

val prepareViewer by tasks.registering(Exec::class) {
    commandLine("npm", "run", "build:viewer", "--prefix", "..")
    inputs.files(fileTree("../viewer"), file("../scripts/build-viewer.mjs"), file("../package-lock.json"))
    outputs.dir("../build/viewer")
}

tasks {
    processResources {
        dependsOn(prepareViewer)
        from("../build/viewer") { into("viewer") }
        from("../assets/docviewkit-omni.svg") {
            into("META-INF")
            rename { "pluginIcon.svg" }
        }
    }
    withType<JavaCompile> {
        sourceCompatibility = "21"
        targetCompatibility = "21"
    }
    withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
        compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
    }
}
