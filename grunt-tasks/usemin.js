/**
 * Created by mcsere on 1/9/15.
 */

module.exports = function (grunt) {
    grunt.config('useminPrepare', {
        html: 'src/index.html',
        options: {
            dest: '<%=env.root%>'
        }
    });
    grunt.config('usemin', {
        html: '<%=env.root%>/index.html'
    });
};