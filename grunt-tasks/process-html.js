/**
 * Created by mcsere on 1/9/15.
 */

module.exports = function (grunt) {
    grunt.config('processhtml', {
        processhtml: {
            options: {
                commentMarker: 'process'
            },
            files: {
                '<%=env.root%>/index.html': '<%=env.root%>/index.html'
            }
        }
    });
};