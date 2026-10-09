package expo.modules.pactocrashlog

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** 진단 화면에서 읽는 크래시 기록 · 최근 앱 종료 사유(안드로이드 11 이상) */
class PactoCrashLogModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("no_context")

  override fun definition() = ModuleDefinition {
    Name("PactoCrashLog")

    Function("readLastCrash") {
      val f = CrashFile.file(context)
      if (f.exists()) f.readText() else null
    }

    Function("clear") {
      CrashFile.file(context).delete()
      LifecycleLog.file(context).delete()
      Unit
    }

    /** 앱 실행 흐름 기록 (Activity·task) — 지금 task 상태를 한 줄 덧붙여 돌려준다 */
    Function("readLifecycle") {
      LifecycleLog.add(context, "read " + LifecycleLog.tasks(context))
      val f = LifecycleLog.file(context)
      if (f.exists()) f.readText() else null
    }

    /** 최근 종료 사유 5건 — 이유 코드·시각·짧은 설명(주소 가림)만 */
    Function("exitReasons") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return@Function emptyList<Map<String, Any?>>()
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      am.getHistoricalProcessExitReasons(context.packageName, 0, 5).map {
        mapOf<String, Any?>(
          "reason" to it.reason,
          "status" to it.status,
          "time" to it.timestamp,
          "description" to CrashFile.scrub(it.description),
        )
      }
    }
  }
}
