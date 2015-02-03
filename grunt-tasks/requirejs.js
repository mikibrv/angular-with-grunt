/**
 * Created by mcsere on 1/9/15.
 */

module.exports = function (grunt) {
    grunt.config('requirejs', {
        compile: {
            options: {
                uglify2: {
                    mangle: false
                },
                baseUrl: "src/app",
                mainConfigFile: "src/app/main.js",
                name: 'main',
                optimize: 'uglify2',//uglify2
                out: "<%=env.root%>/app/app.js",
                replaceRequireScript: [
                    {
                        files: ['<%=env.root%>/index.html'],
                        module: 'main'
                    }
                ],
                done: function (done, output) {
                    done();
                }

            }
        }
    });
};