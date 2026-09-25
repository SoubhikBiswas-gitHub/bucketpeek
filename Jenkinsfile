// Deccan Lens CI/CD.
// Needs: Docker Pipeline plugin, a Jenkins agent with Docker, JUnit plugin.
// Image push runs only on main and only when REGISTRY is set.

pipeline {
  agent any

  options {
    timestamps()
    timeout(time: 45, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '30'))
    disableConcurrentBuilds(abortPrevious: true)
  }

  parameters {
    string(name: 'REGISTRY', defaultValue: '', description: 'Image registry host, e.g. 123456789012.dkr.ecr.ap-south-1.amazonaws.com. Empty skips the push.')
    string(name: 'IMAGE_NAME', defaultValue: 'deccan-lens', description: 'Repository name in the registry.')
    string(name: 'REGISTRY_CREDENTIALS', defaultValue: '', description: 'Jenkins credentials id for the registry (for ECR: ecr:<region>:<aws-credentials-id>).')
    booleanParam(name: 'RUN_E2E', defaultValue: true, description: 'Run Playwright end-to-end tests against the mock bucket.')
  }

  environment {
    NEXT_TELEMETRY_DISABLED = '1'
    CI = 'true'
    NODE_IMAGE = 'node:24-bookworm'
    PLAYWRIGHT_IMAGE = 'mcr.microsoft.com/playwright:v1.63.0-noble'
    IMAGE_TAG = "${env.GIT_COMMIT ? env.GIT_COMMIT.take(12) : env.BUILD_NUMBER}"
  }

  stages {
    stage('Install') {
      agent { docker { image "${NODE_IMAGE}"; reuseNode true } }
      steps {
        sh 'npm ci --no-audit --no-fund'
      }
    }

    stage('Checks') {
      parallel {
        stage('Lint') {
          agent { docker { image "${NODE_IMAGE}"; reuseNode true } }
          steps { sh 'npm run lint' }
        }

        stage('Typecheck') {
          agent { docker { image "${NODE_IMAGE}"; reuseNode true } }
          steps { sh 'npx next typegen && npm run typecheck' }
        }

        stage('Unit tests') {
          agent { docker { image "${NODE_IMAGE}"; reuseNode true } }
          steps {
            sh 'mkdir -p reports && npx vitest run --coverage --reporter=default --reporter=junit --outputFile.junit=reports/unit.xml'
          }
          post {
            always {
              junit allowEmptyResults: true, testResults: 'reports/unit.xml'
              archiveArtifacts allowEmptyArchive: true, artifacts: 'coverage/**'
            }
          }
        }

        stage('E2E tests') {
          when { expression { params.RUN_E2E } }
          agent { docker { image "${PLAYWRIGHT_IMAGE}"; args '-u root'; reuseNode true } }
          environment {
            PLAYWRIGHT_JUNIT_OUTPUT_NAME = 'reports/e2e.xml'
            SECRET_KEY = 'ci-only-secret-not-for-production-0123456789'
          }
          steps {
            sh '''
              apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg zip >/dev/null
              npm run fixtures
              npx playwright test --reporter=line,junit
            '''
          }
          post {
            always {
              junit allowEmptyResults: true, testResults: 'reports/e2e.xml'
              archiveArtifacts allowEmptyArchive: true, artifacts: 'playwright-report/**, test-results/**'
            }
          }
        }

        stage('Docker build') {
          steps {
            script {
              docker.build("${params.IMAGE_NAME}:${env.IMAGE_TAG}", '--pull .')
            }
          }
        }
      }
    }

    stage('Push image') {
      when {
        allOf {
          branch 'main'
          expression { params.REGISTRY?.trim() }
        }
      }
      steps {
        script {
          docker.withRegistry("https://${params.REGISTRY}", params.REGISTRY_CREDENTIALS ?: null) {
            def image = docker.image("${params.IMAGE_NAME}:${env.IMAGE_TAG}")
            image.push(env.IMAGE_TAG)
            image.push('latest')
          }
        }
      }
    }
  }

  post {
    always {
      sh "docker image rm ${params.IMAGE_NAME}:${env.IMAGE_TAG} >/dev/null 2>&1 || true"
    }
  }
}
