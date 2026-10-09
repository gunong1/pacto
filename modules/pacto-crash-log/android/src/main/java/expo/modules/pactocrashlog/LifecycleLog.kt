package expo.modules.pactocrashlog

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.content.ComponentCallbacks2
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.Process
import java.io.File

/**
 * 앱 실행 흐름 기록 (진단용) — 최근 앱 카드 / 앱 아이콘으로 돌아올 때 Activity·task가 어떻게 되는지 확인한다.
 * 남기는 것: 시각 · 사건 이름 · 화면 클래스 이름 · taskId · Intent의 action/flags/category 여부 · task 목록(번호·첫/맨위 화면·화면 수).
 * 남기지 않는 것: Intent 주소(data)·추가값(extras) 내용, 계약서 주소·토큰·내용.
 */
object LifecycleLog {
  private const val NAME = "pacto-lifecycle.txt"
  private const val MAX_LINES = 150

  fun file(context: Context): File = File(context.filesDir, NAME)

  @Synchronized
  fun add(context: Context, line: String) {
    try {
      val f = file(context)
      val lines = if (f.exists()) f.readLines() else emptyList()
      val next = (lines + "${System.currentTimeMillis()} $line").takeLast(MAX_LINES)
      f.writeText(next.joinToString("\n") + "\n")
    } catch (_: Throwable) {
      // 기록 실패는 무시 (앱 동작에 영향 없음)
    }
  }

  private fun short(c: ComponentName?): String = c?.className?.substringAfterLast('.') ?: "-"

  /** Intent 요약 — action·flags·LAUNCHER 여부·data 유무만 (주소·추가값 내용은 남기지 않는다) */
  fun intent(i: Intent?): String {
    if (i == null) return "intent=null"
    val action = i.action?.substringAfterLast('.') ?: "-"
    val launcher = i.categories?.contains(Intent.CATEGORY_LAUNCHER) == true
    return "action=$action flags=0x${Integer.toHexString(i.flags)} launcher=$launcher data=${i.data != null} extras=${i.extras?.size() ?: 0} cmp=${short(i.component)}"
  }

  /** 이 앱의 task 목록 (최근 앱 카드가 가리키는 대상) */
  fun tasks(context: Context): String =
    try {
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val list = am.appTasks.map { t ->
        val info = t.taskInfo
        val id = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) info.taskId else @Suppress("DEPRECATION") info.persistentId
        val running = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) info.isRunning.toString() else "?"
        "#$id base=${short(info.baseActivity)} top=${short(info.topActivity)} n=${info.numActivities} running=$running baseIntent[${intent(info.baseIntent)}]"
      }
      "tasks(${list.size}) " + list.joinToString(" | ")
    } catch (e: Throwable) {
      "tasks=error:${e.javaClass.simpleName}"
    }

  private fun who(a: Activity): String = "${a.javaClass.simpleName} task=${a.taskId} root=${a.isTaskRoot}"

  fun install(app: Application) {
    add(app, "process_start pid=${Process.myPid()}")
    app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityCreated(a: Activity, saved: Bundle?) {
        add(app, "created ${who(a)} restored=${saved != null} ${intent(a.intent)}")
        add(app, tasks(app))
      }
      override fun onActivityStarted(a: Activity) = add(app, "started ${who(a)}")
      override fun onActivityResumed(a: Activity) {
        add(app, "resumed ${who(a)} ${intent(a.intent)}")
        add(app, tasks(app))
      }
      override fun onActivityPaused(a: Activity) = add(app, "paused ${who(a)} finishing=${a.isFinishing}")
      override fun onActivityStopped(a: Activity) {
        add(app, "stopped ${who(a)} finishing=${a.isFinishing} changingConfig=${a.isChangingConfigurations}")
        add(app, tasks(app))
      }
      override fun onActivitySaveInstanceState(a: Activity, out: Bundle) = add(app, "saveState ${who(a)}")
      override fun onActivityDestroyed(a: Activity) {
        add(app, "destroyed ${who(a)} finishing=${a.isFinishing} changingConfig=${a.isChangingConfigurations}")
        add(app, tasks(app))
      }
    })
    app.registerComponentCallbacks(object : ComponentCallbacks2 {
      override fun onTrimMemory(level: Int) = add(app, "trimMemory level=$level")
      override fun onConfigurationChanged(newConfig: Configuration) = Unit
      @Deprecated("Deprecated in Java")
      override fun onLowMemory() = add(app, "lowMemory")
    })
  }
}
